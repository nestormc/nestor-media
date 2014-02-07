/*jshint browser:true*/
/*global define*/

define(["rest"], function(rest) {
	"use strict";

	return {
		get: function() {
			return rest.get("watchedDirs", { limit: 0 });
		}
	};
});