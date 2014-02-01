/*jshint node:true */

var registry = require("nestor-plugin-registry");
var media = require("./media.js");

registry.add(media.manifest, media.init);