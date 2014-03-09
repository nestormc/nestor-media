/*jshint browser:true*/
/*global define*/

define(["rest"], function(rest) {
	"use strict";

	return {
		get: function() {
			return rest.get("watchedDirs", { limit: 0 });
		},

		walk: function(root) {
			return rest.get("subdirs/%s", root);
		},

		add: function(path) {
			return rest.post("watchedDirs", { path: path });
		},

		del: function(path) {
			return rest.del("watchedDirs/%s", path);
		}
	};
});