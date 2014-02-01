/*jshint node:true */
"use strict";

var chokidar = require("chokidar"),
	ffprobe = require("node-ffprobe"),
	mongoose = require("mongoose"),
	when = require("when"),
	spawn = require("child_process").spawn;


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


exports.init = function(nestor) {
	var intents = nestor.intents;
	var logger = nestor.logger;

	var watcher = chokidar.watch([], { persistent: false });

	watcher
		.on("add", function(path) {
			logger.debug("Added: %s", path);
			intents.emit("nestor:scheduler:enqueue", "media:analyze", path);
		})
		.on("change", function(path) {
			logger.debug("Changed: %s", path);
			intents.emit("nestor:scheduler:enqueue", "media:analyze", path);
		})
		.on("unlink", function(path) {
			logger.debug("Removed: %s", path);
			intents.emit("media:removed", path);
		});

	var WatchedDirSchema = new mongoose.Schema(
		{ path: { type: String, unique: true } },
		{ versionKey: false, id: false }
	);

	WatchedDirSchema.pre("save", function(next) {
		if (!this.noWatch)
			watcher.add(this.path);

		next();
	});

	var WatchedDir = mongoose.model("watcheddir", WatchedDirSchema);
	
	intents.on("nestor:rest", function(rest) {
		rest.mongoose("watchedDirs", WatchedDir);
	});

	intents.on("nestor:startup", function() {
		intents.emit("nestor:right", {
			name: "watched-dirs",
			route: "/watchedDirs*",
			description: "Edit watched media directories"
		});

		registerProcessors(intents, logger);

		WatchedDir.find({}, function(err, docs) {
			if (err) {
				nestor.logger.error("Cannot walk watched directories: %s", err.message);
			} else {
				docs.forEach(function(doc) {
					watcher.add(doc.path);
				});
			}
		});
	});

	/* Add watched dirs from config if they don't exist yet */
	if (nestor.config.media.watch) {
		return when.map(nestor.config.media.watch, function(dir) {
			var deferred = when.defer();

			WatchedDir.findOne({ path: dir }, function(err, w) {
				if (!w) {
					nestor.logger.info("Adding %s to watched directories", dir);

					var wdir = new WatchedDir({ path : dir });
					
					// Don't watch directory yet, wait for nestor:startup
					wdir.noWatch = true;

					wdir.save(function(err) {
						if (err) {
							deferred.reject(err);
						} else {
							deferred.resolve();
						}
					});
				} else {
					deferred.resolve();
				}
			});

			return deferred.promise;
		});
	} else {
		return when.resolve();
	}
};

exports.manifest = {
	name: "media",
	description: "Media scanning dispatcher"
};