Media scanning plugin for nestor
================================

This plugin adds a media scanning facility to nestor, with multiple watched directories.

It should not be used directly, it will be automatically added by other plugins (nestor-music and nestor-video).

Internals
---------

### Models

`WatchedDir`: a model to store paths to watched directories

### REST resources

`watchedDirs`: access to watched directories

### Intents

`media:file`: dispatched when a file was discovered or has changed somewhere in a watched directory, with the following arguments:

* full path to the file
* file mimetype
* ffprobe data





