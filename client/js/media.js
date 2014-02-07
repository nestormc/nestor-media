/*jshint browser:true */
/*global define */

define(
["ui", "router", "resource", "ist!templates/watched-dirs"],
function(ui, router, resource, wdTemplate) {
	"use strict";

	ui.started.add(function() {
		/* Setup settings pane */

		var wdView = ui.view("watched-dirs");
		var wdRendered = wdTemplate.render({ dirs: [] });

		wdView.appendChild(wdRendered);

		function updateSettings() {
			return resource.get().then(function(dirs) {
				wdRendered.update({ dirs: dirs._items });
			});
		}

		wdView.displayed.add(updateSettings);

		/* Settings routes */

		router.on("!remove/:id", function(err, req, next) {
			resource.remove(req.match.id)
			.then(updateSettings)
			.then(function() { next(); });
		});
	});


	return {
		views: {
			"watched-dirs": {
				type: "settings",
				title: "Watched directories",
				description: "Manage watched directories",
				icon: "settings"
			}
		}
	};
});