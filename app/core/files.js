'use strict';

var fs = require('fs'),
    _ = require('lodash'),
    mongoose = require('mongoose'),
    helpers = require('./helpers'),
    settings = require('./../config').files,
    enabled = settings.enable,
    provider = _.find([
        require('./files/local'),
        require('./files/s3')
    ], function(provider) { return provider.enabled; });

function FileManager(options) {
    this.core = options.core;
}

FileManager.prototype.create = function(options, cb) {
    var File = mongoose.model('File'),
    Room = mongoose.model('Room'),
    User = mongoose.model('User');

    if (!enabled) {
        return cb('Files are disabled.');
    }

    if (settings.restrictTypes &&
        settings.allowedTypes &&
        settings.allowedTypes.length &&
        !_.include(settings.allowedTypes, options.file.mimetype)) {
            return cb('The MIME type ' + options.file.mimetype +
                      ' is not allowed');
    }

    Room.findById(options.room, function(err, room) {

        if (err) {
            console.error(err);
            return cb(err);
        }
        if (!room) {
            return cb('No room found!');
        }
        if (room.archived) {
            return cb('Room is archived.');
        }

        new File({
            owner: options.owner,
            name: options.file.originalname,
            type: options.file.mimetype,
            size: options.file.size,
            room: options.room
        }).save(function(err, savedFile) {
            provider.save({file: options.file, doc: savedFile}, function(err) {
                if (err) {
                    savedFile.remove();
                    return cb(err);
                }
                // Temporary workaround for _id until populate can do aliasing
                User.findOne(options.owner, function(err, user) {
                    if (err) {
                        console.error(err);
                        return cb(err);
                    }

                    cb(null, savedFile, room, user);

                    this.core.emit('files:new', savedFile, room, user);

                    if (options.post) {
                        this.core.messages.create({
                            room: room,
                            owner: user,
                            text: 'upload://' + savedFile.url
                        });
                    }
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

FileManager.prototype.list = function(options, cb) {
    options = options || {};

    options = helpers.sanitizeQuery(options, {
        defaults: {
            reverse: true,
            take: 500
        },
        maxTake: 5000
    });

    var File = mongoose.model('File'),
        User = mongoose.model('User');

    var find = File.find();

    if (options.room) {
        find.where('room', options.room);
    }

    if (options.from) {
        find.where('uploaded').gt(options.from);
    }

    if (options.to) {
        find.where('uploaded').lte(options.to);
    }

    if (options.expand) {
        var includes = options.expand.split(',');

        if (_.includes(includes, 'owner')) {
            find.populate('owner', 'id username displayName email avatar');
        }
    }

    if (options.skip) {
        find.skip(options.skip);
    }

    if (options.reverse) {
        find.sort({ 'uploaded': -1 });
    } else {
        find.sort({ 'uploaded': 1 });
    }

    find
    .limit(options.take)
    .exec(function(err, files) {
        if (err) {
            console.error(err);
            return cb(err);
        }
        cb(null, files);
    });
};

FileManager.getUrl = provider ? provider.getUrl : function(){};

module.exports = FileManager;
