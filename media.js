/*jshint node:true */
"use strict";

var fs = require("fs"),
	path = require("path"),
	chokidar = require("chokidar"),
	ffprobe = require("node-ffprobe"),
	when = require("when"),
	spawn = require("child_process").spawn;


var DIR_UPDATE_THROTTLE = 2000;
var FILE_EVENT_THROTTLE = 2000;


/*!
 * Scheduler processors registering helper
 */

function registerProcessors(intents, logger) {
	function register(op, processor) {
		intents.emit("nestor:scheduler:register", "media:" + op, processor);
	}

	function enqueue(op, data) {
		intents.emit("nestor:scheduler:enqueue", "media:" + op, data);
	}

	register("analyze", function analyzeFile(path) {
		logger.debug("Get mimetype for %s", path);

		var mime = "";
		var child;

		try {
			child = spawn("file", ["--brief", "--mime-type", path]);
		} catch(e) {
			logger.error("Cannot get mimetype for %s: %s", path, e.message);
			return when.resolve();
		}

		var d = when.defer();

		child.stdout.on("data", function(data) {
			mime += data.toString();
		});

		child.stdout.on("error", function(err) {
			logger.error("Cannot get mimetype for %s: %s", path, err.message);
			d.resolve();
		});

		child.stdout.on("end", function() {
			logger.debug("Got mimetype %s for %s", mime.trim("\n"), path);
			enqueue("ffprobe", { path: path, mime: mime.trim("\n") });
			d.resolve();
		});

		return d.promise;
	});

	register("ffprobe", function probeFile(data) {
		var path = data.path;

		logger.debug("Probe %s", path);

		var d = when.defer();

		ffprobe(path, function(err, metadata) {
			if (err) {
				logger.error("Cannot ffprobe %s: %s", path, err.message);
			} else {
				logger.debug("Dispatching media:file intent for %s", path);
				intents.emit("media:file", path, data.mime, metadata);
			}

			d.resolve();
		});

		return d.promise;
	});
}



/*!
 * Plugin interface
 */

function mediaPlugin(nestor) {
	var intents = nestor.intents;
	var logger = nestor.logger;
	var mongoose = nestor.mongoose;
	var rest = nestor.rest;
	var misc = nestor.misc;


	/*!
	 * Setup chokidar watchers
	 */

	var watchers = {};
	var pending = {};


	// Don't handle changes until there is no change on the same path
	// for at least FILE_EVENT_THROTTLE millisecs
	function signal(change, path) {
		if (path.match(/^\._/)) {
			return;
		}

		if (path in pending) {
			clearTimeout(pending[path]);
		}

		pending[path] = setTimeout(function() {
			delete pending[path];
			if (change === "unlink") {
				intents.emit("media:removed", path);
			} else {
				intents.emit("nestor:scheduler:enqueue", "media:analyze", path);
			}

		}, FILE_EVENT_THROTTLE);
	}


	function addWatcher(path) {
		if (path in watchers) {
			return;
		}

		var watcher = chokidar.watch([path], { persistent: false });

		var markUpdate = misc.throttled(function() {
			WatchedDir.findOneAndUpdate({ path: path }, { lastUpdate: new Date() }, function(err) {
				if (err) {
					logger.warn("Could not update directory %s: %s", path, err.message);
				}
			});
		}, DIR_UPDATE_THROTTLE);


		watcher
			.on("add", function(changedpath) {
				markUpdate();
				signal("add", changedpath);
			})
			.on("change", function(changedpath) {
				markUpdate();
				signal("change", changedpath);
			})
			.on("unlink", function(changedpath) {
				markUpdate();
				signal("unkink", changedpath);
			});


		watchers[path] = watcher;
	}

	function removeWatcher(path) {
		if (!(path in watchers)) {
			return;
		}

		watchers[path].close();
		delete watchers[path];
	}


	/*!
	 * WatchedDir model
	 */

	var WatchedDirSchema = new mongoose.Schema(
		{
			path: { type: String, unique: true },
			lastUpdate: Date
		},
		{ versionKey: false, id: false }
	);

	WatchedDirSchema.post("save", function() {
		addWatcher(this.path);
	});

	WatchedDirSchema.post("remove", function() {
		removeWatcher(this.path);
	});

	var WatchedDir = mongoose.model("watcheddir", WatchedDirSchema);


	/*!
	 * REST resources
	 */

	rest.mongoose("watchedDirs", WatchedDir)
		.set("key", "path");

	rest.resource("subdirs/:root")
		.get(function(req, cb) {
			var root = req.params.root;
			var results = [];
			var nbstats = 0;

			var sent = false;
			function done(err) {
				if (!sent) {
					sent = true;
					if (err) {
						cb(err);
					} else {
						cb(null, results.sort().map(function(dir) {
							return {
								name: dir,
								path: path.join(root, dir)
							};
						}));
					}
				}
			}

			fs.readdir(root, function(err, files) {
				if (err) {
					cb(err);
				} else {
					files.forEach(function(file) {
						fs.stat(path.join(root, file), function(err, stat) {
							if (err) {
								done(err);
								return;
							}

							if (stat.isDirectory() && file[0] !== ".") {
								results.push(file);
							}

							nbstats++;
							if (nbstats === files.length) {
								done();
							}
						});
					});
				}
			});
		});


	/*!
	 * Startup handler
	 */

	intents.on("nestor:startup", function() {
		//intents.emit("nestor:http:watchable", "watcheddirs", WatchedDir);

		intents.emit("nestor:right", {
			name: "watched-dirs",
			route: "/watchedDirs*",
			description: "Edit watched media directories"
		});

		registerProcessors(intents, logger);

		// Start watching directories
		WatchedDir.find({}, function(err, docs) {
			if (err) {
				logger.error("Cannot walk watched directories: %s", err.message);
			} else {
				docs.forEach(function(doc) {
					addWatcher(doc.path);
				});
			}
		});
	});
}

mediaPlugin.manifest = {
	name: "media",
	description: "Media scanning dispatcher",
	client: {
		public: __dirname + "/client/public",
		build: {
			base: __dirname + "/client"
		}
	}
};

module.exports = mediaPlugin;
