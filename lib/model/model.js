var get = Ember.get, set = Ember.set;

require('../collections/model_set');

Ep.ModelMixin = Ember.Mixin.create({

  id: null,
  clientId: null,
  session: null,
  errors: null,

  /**
    Two models are "equal" when they correspond to the same
    key. This does not mean they necessarily have the same data.
  */
  isEqual: function(model) {
    var clientId = get(this, 'clientId');
    var otherClientId = get(model, 'clientId');
    if(clientId && otherClientId) {
      return clientId === otherClientId;
    }
    // in most cases clientIds will always be set, however
    // during serialization this might not be the case
    var id = get(this, 'id');
    var otherId = get(model, 'id')
    return this.isSameType(model) && id === otherId
  },

  isSameType: function(model) {
    return this.hasType(get(model, 'type'));
  },

  /**
    Model promises are just proxies and do not have the
    literal type of their contents.
  */
  hasType: function(type) {
    return get(this, 'type').detect(type);
  },

  type: Ember.computed(function(key, value) {
    return value || this.constructor;
  }),

  toStringExtension: function() {
    return "[" + get(this, 'id') + ", " + get(this, 'clientId') + "]";
  },

  lazyCopy: function() {
    return Ep.LazyModel.create({
      id: get(this, 'id'),
      clientId: get(this, 'clientId'),
      type: get(this, 'type'),
      isDeleted: get(this, 'isDeleted'),
      errors: get(this, 'errors')
    });
  },

  // these properties are volatile so they don't trigger lazy loads
  // on promises by calling `willWatchProperty` on their dependencies
  hasErrors: Ember.computed(function() {
    return !!get(this, 'errors');
  }).volatile(),

  isDetached: Ember.computed(function() {
    return !get(this, 'session');
  }).volatile(),

  isManaged: Ember.computed(function() {
    return !!get(this, 'session');
  }).volatile()

});

Ep.Model = Ember.Object.extend(Ember.Copyable, Ep.ModelMixin, {

  isPromise: false,
  isProxy: false,
  isDeleted: false,
  isLoaded: true,

  // TODO: allow assigning id?
  isNew: Ember.computed(function() {
    return !get(this, 'id');
  }).property('id'),

  clientRevision: Ember.computed(function(key, value) {
    if(arguments.length === 1) {
      return 0;
    }
    return value;
  }),

  // TODO: volatile isDirty

  // TODO: return actual diff contents, not just which fields
  diff: function(model) {
    var diffs = [];

    // TODO: for now we are checking entire fields
    this.eachAttribute(function(name, meta) {
      var left = get(this, name);
      var right = get(model, name);
      if(left instanceof Date && right instanceof Date) {
        left = left.getTime();
        right = right.getTime();
      }
      if(left !== right) {
        // eventually we will have an actual diff
        diffs.push({type: 'attr', name: name});
      }
    }, this);

    this.eachRelationship(function(name, relationship) {
      var left = get(this, name);
      var right = get(model, name);
      if(relationship.kind === 'belongsTo') {
        if(left && right) {
          if(!left.isEqual(right)) {
            diffs.push({type: 'belongsTo', name: name, relationship: relationship, oldValue: right});
          }
        } else if(left || right) {
          diffs.push({type: 'belongsTo', name: name, relationship: relationship, oldValue: right});
        }
      } else if(relationship.kind === 'hasMany') {
        var dirty = false;
        var cache = Ep.ModelSet.create();
        left.forEach(function(model) {
          cache.add(model);
        });
        right.forEach(function(model) {
          if(dirty) return;
          if(!cache.contains(model)) {
            dirty = true;
          } else {
            cache.remove(model);
          }
        });
        if(dirty || get(cache, 'length') > 0) {
          diffs.push({type: 'hasMany', name: name, relationship: relationship});
        }
      }
    }, this);

    return diffs;
  },

  // creates a shallow copy with lazy children
  // TODO: we should not lazily copy detached children
  copy: function() {
    var dest = this.constructor.create();
    dest.beginPropertyChanges();
    this.copyAttributes(dest);
    this.eachRelationship(function(name, relationship) {
      if(relationship.kind === 'belongsTo') {
        var child = get(this, name);
        if(child) {
          set(dest, name, child.lazyCopy());
        }
      } else if(relationship.kind === 'hasMany') {
        var children = get(this, name);
        var destChildren = get(dest, name);
        children.forEach(function(child) {
          destChildren.addObject(child.lazyCopy());
        });
      }
    }, this);
    dest.endPropertyChanges();
    return dest;
  },

  copyAttributes: function(dest) {
    dest.beginPropertyChanges();
    set(dest, 'id', get(this, 'id'));
    set(dest, 'clientId', get(this, 'clientId'));
    set(dest, 'errors', Ember.copy(get(this, 'errors')));
    set(dest, 'isDeleted', get(this, 'isDeleted'));
    this.eachAttribute(function(name, meta) {
      var left = get(this, name);
      var right = get(dest, name);
      // TODO: handle non-primitive attributes
      set(dest, name, left);
    }, this);
    dest.endPropertyChanges();
  }

});


Ep.Model.reopenClass({

  /**
    This is the only static method implemented in order to play nicely
    with Ember's default model conventions in the router. It is preferred
    to explicitly call `load` on a session.

    In order to use this method, you must set the Ep.__container__ property. E.g.

    ```
      Ep.__container__ = App.__container__;
    ```
  */
  find: function(id) {
    if(!Ep.__container__) {
      throw new Ember.Error("The Ep.__container__ property must be set in order to use static find methods.");
    }
    var container = Ep.__container__;
    var session = container.lookup('session:main');
    return session.find(this, id);
  }

});