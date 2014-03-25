/*jshint node:true */
"use strict";

var fs = require("fs"),
	path = require("path"),
	chokidar = require("chokidar"),
	ffprobe = require("node-ffprobe"),
	when = require("when");


var DIR_UPDATE_THROTTLE = 2000;
var FILE_EVENT_THROTTLE = 2000;



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
	function signal(change, changedpath) {
		if (path.basename(changedpath).match(/^\._/)) {
			return;
		}

		if (changedpath in pending) {
			clearTimeout(pending[changedpath]);
		}

		pending[changedpath] = setTimeout(function() {
			delete pending[changedpath];
			if (change === "unlink") {
				intents.emit("media:removed", changedpath);
			} else {
				misc.mimetype(changedpath, function(err, path, mimetype) {
					if (err) {
						logger.error("Cannot get mimetype for %s: %s", path, err.message);
					} else {
						intents.emit("nestor:scheduler:enqueue", "media:ffprobe", { path: path, mime: mimetype });
					}
				});
			}

		}, FILE_EVENT_THROTTLE);
	}


	function addWatcher(dir) {
		if (dir in watchers) {
			return;
		}

		var watcher = chokidar.watch([dir], { persistent: false });

		var markUpdate = misc.throttled(function() {
			WatchedDir.findOneAndUpdate({ path: dir }, { lastUpdate: new Date() }, function(err) {
				if (err) {
					logger.warn("Could not update directory %s: %s", dir, err.message);
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
				signal("unlink", changedpath);
			});


		watchers[dir] = watcher;
	}

	function removeWatcher(dir) {
		if (!(dir in watchers)) {
			return;
		}

		watchers[dir].close();
		delete watchers[dir];
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


		intents.emit("nestor:scheduler:register", "media:ffprobe", function probeFile(data) {
			var path = data.path;

			logger.debug("Probe %s", path);

			var d = when.defer();

			ffprobe(path, function(err, metadata) {
				if (err) {
					metadata = null;
				}

				logger.debug("Dispatching media:file intent for %s", path);
				intents.emit("media:file", path, data.mime, metadata);

				d.resolve();
			});

			return d.promise;
		});

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
