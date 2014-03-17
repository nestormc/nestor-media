/*jshint browser:true */
/*global define */

define(
["ui", "router", "resource", "moment", "ist", "ist!templates/watched-dirs", "ist!templates/add-directory"],
function(ui, router, resource, moment, ist, wdTemplate, adTemplate) {
	"use strict";

	ui.started.add(function() {
		/* Setup settings pane */

		var wdView = ui.view("watched-dirs");
		var wdContext = { dirs: [] };
		var wdRendered = wdTemplate.render(wdContext);

		wdView.appendChild(wdRendered);

		function updateSettings() {
			return resource.get().then(function(dirs) {
				dirs._items.forEach(function(dir) {
					dir.lastUpdate = moment(dir.lastUpdate).fromNow();
				});

				wdContext.dirs = dirs._items;
				wdRendered.update();
			});
		}

		wdView.displayed.add(updateSettings);

		/* Setup add popup */

		var adView = ui.view("add-directory");
		var adRendered;

		adView.displayed.add(function() {
			if (!adRendered) {
				resource.walk("/")
				.then(function(dirs) {
					adRendered = adTemplate.render({ dirs: dirs });
					adView.appendChild(adRendered);
					adView.resize();

					adView.behave({
						".cancel": {
							"click": function() {
								adView.hide();
							}
						}
					});
				});
			}
		});



		/* Settings routes */

		router.on("!walk/:path", function(err, req, next) {
			var path = req.match.path;
			var parent = adView.$("[data-path='" + path + "']");

			if (parent.classList.contains("expanded")) {
				parent.classList.remove("expanded");
				return;
			}

			parent.classList.add("expanded");
			if (parent.classList.contains("walked")) {
				return;
			}

			parent.classList.add("loading");
			parent.classList.add("walked");

			resource.walk(path)
			.then(function(dirs) {
				parent.classList.remove("loading");
				parent.appendChild(ist("@use 'walk-directory-list'").render(dirs));
				adView.resize();
			})
			.otherwise(function() {
				parent.classList.remove("loading");
				parent.classList.add("error");
			});
		});

		router.on("!remove-directory/:path", function(err, req, next) {
			var path = req.match.path;

			resource.del(path)
			.then(updateSettings);
			next();
		});

		router.on("!add-directory/:path", function(err, req, next) {
			var path = req.match.path;

			resource.add(path)
			.then(function() {
				updateSettings();
				adView.hide();
			})
			.otherwise(function() {
				adView.$("[data-path='" + path + "']").classList.add("error");
			});

			next();
		});
	});


	return {
		css: "media",
		views: {
			"watched-dirs": {
				type: "settings",
				title: "Watched directories",
				description: "Manage watched directories",
				icon: "settings",
				actions: [
					{
						"title": "Watch new directory",
						"icon": "add",
						"route": "!media/add-directory"
					}
				]
			},

			"add-directory": {
				type: "popup"
			}
		}
	};
});