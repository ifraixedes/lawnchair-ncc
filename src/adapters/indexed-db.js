/**
 * indexed db adapter
 * ===
 * - originally authored by Vivian Li
 *
 */

LawnchairNcc.adapter('indexed-db', (function () {

  var STORE_NAME = 'lawnchairncc';

  // update the STORE_VERSION when the schema used by this adapter changes
  // (for example, if you change the STORE_NAME above)
  var STORE_VERSION = 2;

  var getIDB = function () {
    return window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.oIndexedDB ||
      window.msIndexedDB;
  };
  var getIDBTransaction = function () {
    return window.IDBTransaction || window.webkitIDBTransaction ||
      window.mozIDBTransaction || window.oIDBTransaction ||
      window.msIDBTransaction;
  };
  var getIDBKeyRange = function () {
    return window.IDBKeyRange || window.webkitIDBKeyRange ||
      window.mozIDBKeyRange || window.oIDBKeyRange ||
      window.msIDBKeyRange;
  };
  var getIDBDatabaseException = function () {
    return window.IDBDatabaseException || window.webkitIDBDatabaseException ||
      window.mozIDBDatabaseException || window.oIDBDatabaseException ||
      window.msIDBDatabaseException;
  };
  var useAutoIncrement = function () {
    // using preliminary mozilla implementation which doesn't support
    // auto-generated keys.  Neither do some webkit implementations.
    return !!window.indexedDB;
  };


  // see https://groups.google.com/a/chromium.org/forum/?fromgroups#!topic/chromium-html5/OhsoAQLj7kc
  var READ_WRITE = (getIDBTransaction() &&
    'READ_WRITE' in getIDBTransaction()) ?
    getIDBTransaction().READ_WRITE : 'readwrite';

  return {

    valid: function () { return !!getIDB(); },

    init: function (options, callback) {

      this.idb = getIDB();
      this.waiting = [];
      this.useAutoIncrement = useAutoIncrement();
      var request = this.idb.open(this.name, STORE_VERSION);
      var self = this;
      var cb = self.fn(self.name, callback);
      var cbWrapper = function (err) {
        // manually clean up event handlers on request; this helps on chrome
        request.onupgradeneeded = request.onsuccess = request.error = null;
        return cb.call(self, err, self);
      };
      var upgrade = function (from, to) {
        // don't try to migrate dbs, just recreate
        try {
          self.db.deleteObjectStore('teststore'); // old adapter
        } catch (e1) { /* ignore */ }
        try {
          self.db.deleteObjectStore(STORE_NAME);
        } catch (e2) { /* ignore */ }

        // ok, create object store.
        var params = {};
        if (self.useAutoIncrement) { params.autoIncrement = true; }
        self.db.createObjectStore(STORE_NAME, params);
        self.store = true;
      };


      request.onupgradeneeded = function (event) {
        self.db = request.result;
        self.transaction = request.transaction;
        upgrade(event.oldVersion, event.newVersion);
        // will end up in onsuccess callback
      };
      request.onsuccess = function (event) {
        self.db = request.result;

        if (self.db.version != ('' + STORE_VERSION)) {
          // DEPRECATED API: modern implementations will fire the
          // upgradeneeded event instead.
          var oldVersion = self.db.version;
          var setVrequest = self.db.setVersion('' + STORE_VERSION);
          // onsuccess is the only place we can create Object Stores
          setVrequest.onsuccess = function (event) {
            var transaction = setVrequest.result;
            setVrequest.onsuccess = setVrequest.onerror = null;
            // can't upgrade w/o versionchange transaction.
            upgrade(oldVersion, STORE_VERSION);
            transaction.oncomplete = function () {
              for (var i = 0; i < self.waiting.length; i++) {
                self.waiting[i].call(self);
              }
              self.waiting = [];
              cbWrapper();
            };
          };
          setVrequest.onerror = function (e) {
            setVrequest.onsuccess = setVrequest.onerror = null;
            console.log("Failed to create objectstore " + e);
            cbWrapper(e);
          };
        } else {
          self.store = true;
          for (var i = 0; i < self.waiting.length; i++) {
            self.waiting[i].call(self);
          }
          self.waiting = [];
          cbWrapper();
        }
      }
      request.onerror = function (ev) {
        if (request.errorCode === getIDBDatabaseException().VERSION_ERR) {
          // xxx blow it away
          self.idb.deleteDatabase(self.name);
          // try it again.
          return self.init(options, callback);
        }
        console.error('Failed to open database');
      };
    },

    save: function (obj, callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.save(obj, callback);
        });
        return;
      }

      var self = this;
      var request;

      var cbWrapper = function (err, result) {
        // manually clean up event handlers; helps free memory on chrome.
        request.onsuccess = request.onerror = null;

        if (callback) {
          if (result) {
            obj.key = result.target.result;
          }

          if (err) {
            self.lambda(callback).call(self, err, obj)
          } else {
            self.lambda(callback).call(self, null, obj)
          }
        }
      };

      var trans = this.db.transaction(STORE_NAME, READ_WRITE);
      var store = trans.objectStore(STORE_NAME);
      if (obj.key) {
        request = store.put(obj, obj.key);
      } else if (this.useAutoIncrement) {
        request = store.put(obj); // use autoIncrementing key.
      } else {
        request = store.put(obj, this.uuid()); // use randomly-generated key
      }

      request.onsuccess = function (event) {
        cbWrapper(null, event);
      };
      request.onerror = function (event) {
        cbWrapper(event, null);
      };

      return this;
    },

    batch: function (objs, callback) {
      var self = this;
      var cbWrapper = function (err, result) {
        if (callback) {
          self.lambda(callback).call(self, err, result)
        }
      };

      var results = [];
      var done = objs.length;
      var errors = [];
      var numErrors = 0;

      var putOne = function (i) {
        self.save(objs[i], function (err, obj) {

          if (err) {
            numErrors++;
            errors[i] = err;
          } else {
            errors[i] = null;
          }

          results[i] = obj;
          if ((--done) > 0) { return; }

          if (numErrors > 0) {
            cbWrapper(errors, results);
          } else {
            cbWrapper(null, results);
          }

        });
      };

      for (var i = 0, l = objs.length; i < l; i++)
        putOne(i);

      return this
    },


    get: function (key, callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.get(key, callback);
        });
        return;
      }

      var self = this;
      var cbWrapper = function (err, result) {
        var r;
        req.onsuccess = req.onerror = null;

        if (result) {
          r = result.target.result;
        }

        if (callback) {
          if (r) { r.key = key; }
          self.lambda(callback).call(self, err, r);
        }
      };

      if (!this.isArray(key)) {
        var req = this.db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);

        req.onsuccess = function (event) {
          cbWrapper(null, event);
        };
        req.onerror = function (event) {
          console.log("Failed to find " + key);
          cbWrapper(event, null);
        };

      } else {

        // note: these are hosted.
        var results = [];
        var errors = [];
        var numErrors = 0;
        var done = key.length;
        var keys = key;

        var getOne = function (i) {
          self.get(keys[i], function (err, obj) {

            if (err) {
              numErrors++;
              errors[i] = err;
            } else {
              results[i] = null;
            }

            results[i] = obj;

            if ((--done) > 0) { return; }
            if (callback) {
              if (numErrors > 0) {
                self.lambda(callback).call(self, errors, results);
              } else {
                self.lambda(callback).call(self, null, results);
              }
            }
          });
        };
        for (var i = 0, l = keys.length; i < l; i++)
          getOne(i);
      }

      return this;
    },

    exists: function (key, callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.exists(key, callback);
        });
        return;
      }

      var self = this;
      var cbWrapper = function (err, result) {
        // manually clean up event handlers; helps free memory on chrome.
        req.onsuccess = req.onerror = null;

        if (callback) {
          if (err) {
            self.lambda(callback).call(self, err, result)
          } else {
            self.lambda(callback).call(self, null, result)
          }
        }
      };

      var req = this.db.transaction(STORE_NAME).objectStore(STORE_NAME).openCursor(getIDBKeyRange().only(key));

      req.onsuccess = function (event) {
        // exists iff req.result is not null
        // XXX but firefox returns undefined instead, sigh XXX
        var undef;
        cbWrapper(null, event.target.result !== null &&
          event.target.result !== undef);
      };
      req.onerror = function (event) {
        console.log("Failed to test for " + key);
        cbWrapper(event, null);
      };

      return this;
    },

    all: function (callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.all(callback);
        });
        return;
      }

      var self = this;
      var cbWrapper = function (err, result) {
        if (callback) {
          var cb = self.fn(self.name, callback);
          cb.call(self, err, result)
        }
      };

      var objectStore = this.db.transaction(STORE_NAME).objectStore(STORE_NAME);
      var toReturn = [];
      objectStore.openCursor().onsuccess = function (event) {
        var cursor = event.target.result;
        if (cursor) {
          toReturn.push(cursor.value);
          cursor['continue']();
        }
        else {
          cbWrapper(null, toReturn);
        }
      };
      return this;
    },

    keys: function (callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.keys(callback);
        });
        return;
      }

      var self = this;
      var cbWrapper = function (err, result) {
        if (callback) {
          var cb = self.fn(self.name, callback);
          cb.call(self, err, result)
        }
      };

      var objectStore = this.db.transaction(STORE_NAME).objectStore(STORE_NAME);
      var toReturn = [];
      // in theory we could use openKeyCursor() here, but no one actually
      // supports it yet.
      objectStore.openCursor().onsuccess = function (event) {
        var cursor = event.target.result;
        if (cursor) {
          toReturn.push(cursor.key);
          cursor['continue']();
        }
        else {
          cbWrapper(null, toReturn);
        }
      };
      return this;
    },

    remove: function (keyOrArray, callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.remove(keyOrArray, callback);
        });
        return;
      }
      var self = this;
      var cbWrapper = function (err) {
        if (callback) {
          self.lambda(callback).call(self, err);
        }
      };

      if (this.isArray(keyOrArray)) {
        // batch remove
        var i, done = keyOrArray.length;
        var errors = [];
        var numErrors = 0;

        var removeOne = function (i) {
          self.remove(keyOrArray[i], function (err) {

            if (err) {
              numErrors++;
              errors[i] = err;
            } else {
              errors[i] = null;
            }

            if ((--done) > 0) { return; }
            if (callback) {
              if (numErrors > 0) {
                cbWrapper(errors);
              } else {
                cbWrapper(null);
              }

            }
          });
        };
        for (i = 0; i < keyOrArray.length; i++)
          removeOne(i);
        return this;
      }
      var request;
      var key = keyOrArray.key ? keyOrArray.key : keyOrArray;
      request = this.db.transaction(STORE_NAME, READ_WRITE).objectStore(STORE_NAME)['delete'](key);
      request.onsuccess = function (event) {
        cbWrapper();
      };
      request.onerror = function (event) {
        cbWrapper(event);
      };
      return this;
    },

    nuke: function (callback) {
      if (!this.store) {
        this.waiting.push(function () {
          this.nuke(callback);
        });
        return;
      }

      var self = this;
      var cbWrapper = function (err) {
        if (callback) {
          self.lambda(callback).call(self, err);
        }
      };

      try {
        this.db
          .transaction(STORE_NAME, READ_WRITE)
          .objectStore(STORE_NAME).clear().onsuccess = function (event) {
          cbWrapper();
        };

      } catch (e) {
        cbWrapper(e);
      }
      return this;
    }

  };

})());
