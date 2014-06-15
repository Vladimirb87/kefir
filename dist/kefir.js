/*! kefir - 0.1.12
 *  https://github.com/pozadi/kefir
 */
(function(global){
  "use strict";

function noop() {}

function id(x) {return x}

function get(map, key, notFound) {
  if (map && key in map) {
    return map[key];
  } else {
    return notFound;
  }
}

function own(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function toArray(arrayLike) {
  if (isArray(arrayLike)) {
    return arrayLike;
  } else {
    return Array.prototype.slice.call(arrayLike);
  }
}

function createObj(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F();
}

function extend(/*target, mixin1, mixin2...*/) {
  if (arguments.length === 1) {
    return arguments[0];
  }
  var result = arguments[0];
  for (var i = 1; i < arguments.length; i++) {
    for (var prop in arguments[i]) {
      if(own(arguments[i], prop)) {
        result[prop] = arguments[i][prop];
      }
    }
  }
  return result;
}

function inherit(Child, Parent/*[, mixin1, mixin2, ...]*/) {
  Child.prototype = createObj(Parent.prototype);
  Child.prototype.constructor = Child;
  for (var i = 2; i < arguments.length; i++) {
    extend(Child.prototype, arguments[i]);
  }
  return Child;
}

function agrsToArray(args) {
  if (args.length === 1 && isArray(args[0])) {
    return args[0];
  }
  return toArray(args);
}

function rest(arr, start, onEmpty) {
  if (arr.length > start) {
    return Array.prototype.slice.call(arr, start);
  }
  return onEmpty;
}

function getFn(fn, context) {
  if (isFn(fn)) {
    return fn;
  } else {
    if (context == null || !isFn(context[fn])) {
      throw new Error('not a function: ' + fn + ' in ' + context);
    } else {
      return context[fn];
    }
  }
}

function isFn(fn) {
  return typeof fn === 'function';
}

function isUndefined(x) {
  return typeof x === 'undefined';
}

function isArray(xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
}

var isArguments = function(xs) {
  return Object.prototype.toString.call(xs) === '[object Arguments]';
}

// For IE
if (!isArguments(arguments)) {
  isArguments = function(obj) {
    return !!(obj && own(obj, 'callee'));
  }
}

function isEqualArrays(a, b) {
  if (a == null && b == null) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

var now = Date.now ?
  function() { return Date.now() } :
  function() { return new Date().getTime() };

var Kefir = {};



// Special values

var NOTHING = Kefir.NOTHING = ['<nothing>'];
var END = Kefir.END = ['<end>'];
var NO_MORE = Kefir.NO_MORE = ['<no more>'];

var KefirError = function(error) {
  this.error = error;
}
Kefir.error = function(error) {
  return new KefirError(error);
}




// Callable

function Callable(fnMeta) {
  if (isFn(fnMeta) || (fnMeta instanceof Callable)) {
    return fnMeta;
  }
  if (fnMeta && fnMeta.length) {
    if (fnMeta.length === 1) {
      if (isFn(fnMeta[0])) {
        return fnMeta[0];
      } else {
        throw new Error('can\'t convert to Callable ' + fnMeta);
      }
    }
    this.fn = getFn(fnMeta[0], fnMeta[1]);
    this.context = fnMeta[1];
    this.args = rest(fnMeta, 2, null);
  } else {
    throw new Error('can\'t convert to Callable ' + fnMeta);
  }
}


function callFast(fn, context, args) {
  if (context != null) {
    if (!args || args.length === 0) {
      return fn.call(context);
    } else {
      return fn.apply(context, args);
    }
  } else {
    if (!args || args.length === 0) {
      return fn();
    } else if (args.length === 1) {
      return fn(args[0]);
    } else if (args.length === 2) {
      return fn(args[0], args[1]);
    } else if (args.length === 3) {
      return fn(args[0], args[1], args[2]);
    }
    return fn.apply(null, args);
  }
}

Callable.call = function(callable, args) {
  if (isFn(callable)) {
    return callFast(callable, null, args);
  } else if (callable instanceof Callable) {
    if (callable.args) {
      if (args) {
        args = callable.args.concat(toArray(args));
      } else {
        args = callable.args;
      }
    }
    return callFast(callable.fn, callable.context, args);
  } else {
    return Callable.call(new Callable(callable), args);
  }
}

Callable.isEqual = function(a, b) {
  if (a === b) {
    return true;
  }
  a = new Callable(a);
  b = new Callable(b);
  if (isFn(a) || isFn(b)) {
    return a === b;
  }
  return a.fn === b.fn &&
    a.context === b.context &&
    isEqualArrays(a.args, b.args);
}







// Observable

var Observable = Kefir.Observable = function Observable(onFirstIn, onLastOut) {

  // __onFirstIn, __onLastOut can also be added to prototype of child classes
  if (isFn(onFirstIn)) {
    this.__onFirstIn = onFirstIn;
  }
  if (isFn(onLastOut)) {
    this.__onLastOut = onLastOut;
  }

  this.__subscribers = {
    value: null,
    error: null,
    both: null,
    end: null
  };

  this.alive = true;
  this.active = false;

}

inherit(Observable, Object, {

  __ClassName: 'Observable',

  toString: function() {
    return '[' + this.__ClassName + (this.__objName ? (' | ' + this.__objName) : '') + ']';
  },

  __onFirstIn: noop,
  __onLastOut: noop,

  __addSubscriber: function(type, fnMeta) {
    if (this.__subscribers[type] === null) {
      this.__subscribers[type] = [];
    }
    this.__subscribers[type].push(new Callable(fnMeta));
  },

  __removeSubscriber: function(type, fnMeta) {
    var subs = this.__subscribers[type];
    if (subs !== null) {
      var callable = new Callable(fnMeta);
      for (var i = 0; i < subs.length; i++) {
        if (Callable.isEqual(subs[i], callable)) {
          subs.splice(i, 1);
          return;
        }
      }
    }
  },

  __on: function(type, fnMeta) {
    if (this.alive) {
      this.__addSubscriber(type, fnMeta);
      if (!this.active && type !== 'end') {
        this.active = true;
        this.__onFirstIn();
      }
    } else if (type === 'end') {
      Callable.call(fnMeta);
    }
  },
  __off: function(type, fnMeta) {
    if (this.alive) {
      this.__removeSubscriber(type, fnMeta);
      if (this.active && type !== 'end' && !this.__hasSubscribers()) {
        this.active = false;
        this.__onLastOut();
      }
    }
  },
  __send: function(type, x) {
    var i, l, subs, args;
    if (this.alive) {
      if (type === 'end') {
        subs = this.__subscribers.end;
        if (subs !== null) {
          subs = subs.slice(0);
          for (i = 0, l = subs.length; i < l; i++) {
            Callable.call(subs[i]);
          }
        }
        this.__clear();
      } else if (this.active) {
        subs = (type === 'value') ? this.__subscribers.value : this.__subscribers.error;
        if (subs !== null) {
          subs = subs.slice(0);
          args = [x];
          for (i = 0, l = subs.length; i < l; i++) {
            if (Callable.call(subs[i], args) === NO_MORE) {
              this.__off(type, subs[i]);
            }
          }
        }
        subs = this.__subscribers.both;
        if (subs !== null) {
          subs = subs.slice(0);
          args = [type, x];
          for (i = 0, l = subs.length; i < l; i++) {
            if (Callable.call(subs[i], args) === NO_MORE) {
              this.__off('both', subs[i]);
            }
          }
        }
      }
    }
  },
  __hasSubscribers: function() {
    var s = this.__subscribers;
    return (s.value !== null && s.value.length > 0) ||
      (s.error !== null && s.error.length > 0) ||
      (s.both !== null && s.both.length > 0);
  },
  __clear: function() {
    if (this.active) {
      this.active = false;
      this.__onLastOut();
    }
    if (own(this, '__onFirstIn')) {
      this.__onFirstIn = null;
    }
    if (own(this, '__onLastOut')) {
      this.__onLastOut = null;
    }
    this.__subscribers = null;
    this.alive = false;
  },


  __sendValue: function(x) {
    this.__send('value', x);
    return this;
  },
  __sendError: function(x) {
    this.__send('error', x);
    return this;
  },
  __sendEnd: function() {
    this.__send('end');
    return this;
  },
  __sendAny: function(x) {
    if (x === NOTHING) {  return this  }
    if (x === END) {  this.__sendEnd(); return this  }
    if (x instanceof KefirError) {  this.__sendError(x.error); return this  }
    this.__sendValue(x);
    return this;
  },


  onValue: function() {
    this.__on('value', arguments);
    return this;
  },
  offValue: function() {
    this.__off('value', arguments);
    return this;
  },
  onError: function() {
    this.__on('error', arguments);
    return this;
  },
  offError: function() {
    this.__off('error', arguments);
    return this;
  },
  onBoth: function() {
    this.__on('both', arguments);
    return this;
  },
  offBoth: function() {
    this.__off('both', arguments);
    return this;
  },
  onEnd: function() {
    this.__on('end', arguments);
    return this;
  },
  offEnd: function() {
    this.__off('end', arguments);
    return this;
  },

  isEnded: function() {
    return !this.alive;
  }


})




// Stream

var Stream = Kefir.Stream = function Stream() {
  Observable.apply(this, arguments);
}

inherit(Stream, Observable, {
  __ClassName: 'Stream'
})




// Property

var Property = Kefir.Property = function Property(onFirstIn, onLastOut, initial) {
  Observable.call(this, onFirstIn, onLastOut);
  this.__cached = isUndefined(initial) ? NOTHING : initial;
}

inherit(Property, Observable, {

  __ClassName: 'Property',

  hasValue: function() {
    return this.__cached !== NOTHING;
  },
  getValue: function() {
    return this.__cached;
  },

  __sendValue: function(x) {
    if (this.alive) {
      this.__cached = x;
    }
    Observable.prototype.__sendValue.call(this, x);
  },
  onNewValue: function() {
    this.__on('value', arguments);
    return this;
  },
  onValue: function() {
    if (this.hasValue()) {
      Callable.call(arguments, [this.getValue()]);
    }
    return this.onNewValue.apply(this, arguments);
  },
  onNewBoth: function() {
    this.__on('both', arguments);
    return this;
  },
  onBoth: function() {
    if (this.hasValue()) {
      Callable.call(arguments, ['value', this.getValue()]);
    }
    return this.onNewBoth.apply(this, arguments);
  }

})

extend(Stream.prototype, {
  onNewValue: function() {
    return this.onValue.apply(this, arguments);
  },
  onNewBoth: function() {
    return this.onBoth.apply(this, arguments);
  }
});



// Log

var logHelper = function(name, type, x) {
  console.log(name, type, x);
}

Observable.prototype.log = function(name) {
  if (name == null) {
    name = this.toString();
  }
  this.onValue(logHelper, null, name, '<value>');
  this.onError(logHelper, null, name, '<error>');
  this.onEnd(logHelper, null, name, '<end>');
  return this;
}

// TODO
//
// Kefir.constant(x)
// Kefir.fromArray(values)
// Kefir.fromCallback(fn)
// Kefir.fromNodeCallback(fn)
// Kefir.fromPromise(promise)



// Kefir.never()

var neverObj = new Stream();
neverObj.__sendEnd();
neverObj.__ClassName = 'NeverStream'
Kefir.never = function() {  return neverObj  }




// Kefir.once(x)

var OnceStream = function OnceStream(value) {
  Stream.call(this);
  this.__value = value;
}

inherit(OnceStream, Stream, {

  __ClassName: 'OnceStream',
  onValue: function() {
    if (this.alive) {
      Callable.call(arguments, [this.__value]);
      this.__value = null;
      this.__sendEnd();
    }
    return this;
  },
  onBoth: function() {
    if (this.alive) {
      Callable.call(arguments, ['value', this.__value]);
      this.__value = null;
      this.__sendEnd();
    }
    return this;
  },
  onError: noop

})

Kefir.once = function(x) {
  return new OnceStream(x);
}





// Kefir.fromBinder(fn)

var FromBinderStream = function FromBinderStream(subscribeFnMeta) {
  Stream.call(this);
  this.__subscribeFn = new Callable(subscribeFnMeta);
}

inherit(FromBinderStream, Stream, {

  __ClassName: 'FromBinderStream',
  __onFirstIn: function() {
    var _this = this;
    this.__unsubscribe = Callable.call(this.__subscribeFn, [function(x) {
      _this.__sendAny(x);
    }]);
  },
  __onLastOut: function() {
    if (isFn(this.__unsubscribe)) {
      this.__unsubscribe();
    }
    this.__unsubscribe = null;
  },
  __clear: function() {
    Stream.prototype.__clear.call(this);
    this.__subscribeFn = null;
  }

})

Kefir.fromBinder = function(/*subscribe[, context[, arg1, arg2...]]*/) {
  return new FromBinderStream(arguments);
}

// TODO
//
// observable.debounce(wait, immediate)
// http://underscorejs.org/#defer


function createOneSourceClasses(classNamePrefix, methodName, methods) {

  var defaultMethods = {
    __init: function(args) {},
    __afterInitial: function(args) {},
    __free: function() {},
    __handleValue: function(x, initial) {  this.__sendValue(x)  },
    __handleError: function(e) {  this.__sendError(e)  },
    __handleEnd: function() {  this.__sendEnd()  },
  }

  var mixin = extend({
    __handleErrorOrValue: function(type, x) {
      if (type === 'value') {
        this.__handleValue(x);
      } else {
        this.__handleError(x);
      }
    },
    __onFirstIn: function() {
      this.__source.onNewBoth(this.__handleErrorOrValue, this);
    },
    __onLastOut: function() {
      this.__source.offBoth(this.__handleErrorOrValue, this);
    }
  }, defaultMethods, methods);


  function AnonymousOneSourceStream(source, args) {
    Stream.call(this);
    this.__source = source;
    this.__init(args);
    this.__afterInitial(args);
    source.onEnd(this.__handleEnd, this);
  }

  inherit(AnonymousOneSourceStream, Stream, mixin, {
    __ClassName: classNamePrefix + 'Stream',
    __clear: function() {
      Stream.prototype.__clear.call(this);
      this.__source = null;
      this.__free();
    }
  });


  function AnonymousOneSourceProperty(source, args) {
    Property.call(this);
    this.__source = source;
    this.__init(args);
    if (source instanceof Property && source.hasValue()) {
      this.__handleValue(source.getValue(), true);
    }
    this.__afterInitial(args);
    source.onEnd(this.__handleEnd, this);
  }

  inherit(AnonymousOneSourceProperty, Property, mixin, {
    __ClassName: classNamePrefix + 'Property',
    __clear: function() {
      Property.prototype.__clear.call(this);
      this.__source = null;
      this.__free();
    }
  });


  if (methodName) {
    Stream.prototype[methodName] = function() {
      return new AnonymousOneSourceStream(this, arguments);
    }
    Property.prototype[methodName] = function() {
      return new AnonymousOneSourceProperty(this, arguments);
    }
  }


  return {
    Stream: AnonymousOneSourceStream,
    Property: AnonymousOneSourceProperty
  };
}





// .map(fn)

createOneSourceClasses(
  'Mapped',
  'map',
  {
    __init: function(args) {
      this.__fn = new Callable(args);
    },
    __free: function() {
      this.__fn = null;
    },
    __handleValue: function(x) {
      this.__sendAny(Callable.call(this.__fn, [x]));
    }
  }
)





// .filter(fn)

createOneSourceClasses(
  'Filtered',
  'filter',
  {
    __init: function(args) {
      this.__fn = new Callable(args);
    },
    __free: function() {
      this.__fn = null;
    },
    __handleValue: function(x) {
      if (Callable.call(this.__fn, [x])) {
        this.__sendValue(x);
      }
    }
  }
)




// .diff(seed, fn)

createOneSourceClasses(
  'Diff',
  'diff',
  {
    __init: function(args) {
      this.__prev = args[0];
      this.__fn = new Callable(rest(args, 1));
    },
    __free: function() {
      this.__prev = null;
      this.__fn = null;
    },
    __handleValue: function(x) {
      this.__sendValue(Callable.call(this.__fn, [this.__prev, x]));
      this.__prev = x;
    }
  }
)




// .takeWhile(fn)

createOneSourceClasses(
  'TakeWhile',
  'takeWhile',
  {
    __init: function(args) {
      this.__fn = new Callable(args);
    },
    __free: function() {
      this.__fn = null;
    },
    __handleValue: function(x) {
      if (Callable.call(this.__fn, [x])) {
        this.__sendValue(x);
      } else {
        this.__sendEnd();
      }
    }
  }
)





// .take(n)

createOneSourceClasses(
  'Take',
  'take',
  {
    __init: function(args) {
      this.__n = args[0];
      if (this.__n <= 0) {
        this.__sendEnd();
      }
    },
    __handleValue: function(x) {
      this.__n--;
      this.__sendValue(x);
      if (this.__n === 0) {
        this.__sendEnd();
      }
    }
  }
)





// .skip(n)

createOneSourceClasses(
  'Skip',
  'skip',
  {
    __init: function(args) {
      this.__n = args[0];
    },
    __handleValue: function(x) {
      if (this.__n <= 0) {
        this.__sendValue(x);
      } else {
        this.__n--;
      }
    }
  }
)




// .skipDuplicates([fn])

function strictlyEqual(a, b) {  return a === b  }

createOneSourceClasses(
  'SkipDuplicates',
  'skipDuplicates',
  {
    __init: function(args) {
      if (args.length > 0) {
        this.__fn = new Callable(args);
      } else {
        this.__fn = strictlyEqual;
      }
      this.__prev = NOTHING;
    },
    __free: function() {
      this.__fn = null;
      this.__prev = null;
    },
    __handleValue: function(x) {
      if (this.__prev === NOTHING || !Callable.call(this.__fn, [this.__prev, x])) {
        this.__sendValue(x);
      }
      this.__prev = x;
    }
  }
)





// .skipWhile(fn)

createOneSourceClasses(
  'SkipWhile',
  'skipWhile',
  {
    __init: function(args) {
      this.__fn = new Callable(args);
      this.__skip = true;
    },
    __free: function() {
      this.__fn = null;
    },
    __handleValue: function(x) {
      if (!this.__skip) {
        this.__sendValue(x);
        return;
      }
      if (!Callable.call(this.__fn, [x])) {
        this.__skip = false;
        this.__fn = null;
        this.__sendValue(x);
      }
    }
  }
)



// property.changes()

var ChangesStream = createOneSourceClasses(
  'Changes'
).Stream;

Stream.prototype.changes = function() {
  return this;
}

Property.prototype.changes = function() {
  return new ChangesStream(this);
}





// observable.toProperty([initial])

var ToPropertyProperty = createOneSourceClasses(
  'ToProperty',
  null,
  {
    __afterInitial: function(initial) {
      if (initial !== NOTHING && !isUndefined(initial)) {
        this.__sendValue(initial);
      }
    }
  }
).Property;

Stream.prototype.toProperty = function(initial) {
  return new ToPropertyProperty(this, initial);
}

Property.prototype.toProperty = function(initial) {
  if (isUndefined(initial) || initial === NOTHING) {
    return this
  } else {
    return new ToPropertyProperty(this, initial);
  }
}





// .scan(seed, fn)

var ScanProperty = createOneSourceClasses(
  'Scan',
  null,
  {
    __init: function(args) {
      this.__sendValue(args[0]);
      this.__fn = new Callable(rest(args, 1));
    },
    __free: function(){
      this.__fn = null;
    },
    __handleValue: function(x) {
      this.__sendValue(Callable.call(this.__fn, [this.getValue(), x]));
    }
  }
).Property;

Observable.prototype.scan = function() {
  return new ScanProperty(this, arguments);
}





// .reduce(seed, fn)

var ReducedProperty = createOneSourceClasses(
  'Reduced',
  null,
  {
    __init: function(args) {
      this.__result = args[0];
      this.__fn = new Callable(rest(args, 1));
    },
    __free: function(){
      this.__fn = null;
      this.__result = null;
    },
    __handleValue: function(x) {
      this.__result = Callable.call(this.__fn, [this.__result, x]);
    },
    __handleEnd: function() {
      this.__sendValue(this.__result);
      this.__sendEnd();
    }
  }
).Property;

Observable.prototype.reduce = function() {
  return new ReducedProperty(this, arguments);
}






// .throttle(wait, {leading, trailing})

createOneSourceClasses(
  'Throttled',
  'throttle',
  {
    __init: function(args) {
      this.__wait = args[0];
      this.__leading = get(args[1], 'leading', true);
      this.__trailing = get(args[1], 'trailing', true);
      this.__trailingCallValue = null;
      this.__trailingCallTimeoutId = null;
      this.__endAfterTrailingCall = false;
      this.__lastCallTime = 0;
      var _this = this;
      this.__makeTrailingCallBinded = function() {  _this.__makeTrailingCall()  };
    },
    __free: function() {
      this.__trailingCallValue = null;
      this.__makeTrailingCallBinded = null;
    },
    __handleValue: function(x, initial) {
      if (initial) {
        this.__sendValue(x);
        return;
      }
      var curTime = now();
      if (this.__lastCallTime === 0 && !this.__leading) {
        this.__lastCallTime = curTime;
      }
      var remaining = this.__wait - (curTime - this.__lastCallTime);
      if (remaining <= 0) {
        this.__cancelTralingCall();
        this.__lastCallTime = curTime;
        this.__sendValue(x);
      } else if (this.__trailing) {
        this.__scheduleTralingCall(x, remaining);
      }
    },
    __handleEnd: function() {
      if (this.__trailingCallTimeoutId) {
        this.__endAfterTrailingCall = true;
      } else {
        this.__sendEnd();
      }
    },
    __scheduleTralingCall: function(value, wait) {
      if (this.__trailingCallTimeoutId) {
        this.__cancelTralingCall();
      }
      this.__trailingCallValue = value;
      this.__trailingCallTimeoutId = setTimeout(this.__makeTrailingCallBinded, wait);
    },
    __cancelTralingCall: function() {
      if (this.__trailingCallTimeoutId !== null) {
        clearTimeout(this.__trailingCallTimeoutId);
        this.__trailingCallTimeoutId = null;
      }
    },
    __makeTrailingCall: function() {
      this.__sendValue(this.__trailingCallValue);
      this.__trailingCallTimeoutId = null;
      this.__trailingCallValue = null;
      this.__lastCallTime = !this.__leading ? 0 : now();
      if (this.__endAfterTrailingCall) {
        this.__sendEnd();
      }
    }
  }
)







// .delay()

createOneSourceClasses(
  'Delayed',
  'delay',
  {
    __init: function(args) {
      this.__wait = args[0];
    },
    __handleValue: function(x, initial) {
      if (initial) {
        this.__sendValue(x);
        return;
      }
      var _this = this;
      setTimeout(function() {  _this.__sendValue(x)  }, this.__wait);
    },
    __handleEnd: function() {
      var _this = this;
      setTimeout(function() {  _this.__sendEnd()  }, this.__wait);
    }
  }
)

// TODO
//
// observable.filter(property)
// observable.takeWhile(property)
// observable.skipWhile(property)
//
// observable.awaiting(otherObservable)
// stream.skipUntil(stream2)




// TODO: all this should be refactored and moved to multiple-sources



// tmp
var WithSourceStreamMixin = {
  __Constructor: function(source) {
    this.__source = source;
    source.onEnd(this.__sendEnd, this);
    if (source instanceof Property && this instanceof Property && source.hasValue()) {
      this.__handle(source.getValue());
    }
  },
  __handle: function(x) {
    this.__sendAny(x);
  },
  __handleBoth: function(type, x) {
    if (type === 'value') {
      this.__handle(x);
    } else {
      this.__sendError(x);
    }
  },
  __onFirstIn: function() {
    this.__source.onNewBoth(this.__handleBoth, this);
  },
  __onLastOut: function() {
    this.__source.offBoth(this.__handleBoth, this);
  },
  __clear: function() {
    Observable.prototype.__clear.call(this);
    this.__source = null;
  }
}





// .sampledBy(observable, fn)
// TODO: Kefir.sampledBy(streams, samplers, fn)

var SampledByMixin = {
  __Constructor: function(main, sampler, fnMeta) {
    if (this instanceof Property) {
      Property.call(this);
    } else {
      Stream.call(this);
    }
    this.__transformer = fnMeta && (new Callable(fnMeta));
    this.__mainStream = main;
    this.__lastValue = NOTHING;
    if (main instanceof Property && main.hasValue()) {
      this.__lastValue = main.getValue();
    }
    WithSourceStreamMixin.__Constructor.call(this, sampler);
  },
  __handle: function(y) {
    if (this.__lastValue !== NOTHING) {
      var x = this.__lastValue;
      if (this.__transformer) {
        x = Callable.call(this.__transformer, [x, y]);
      }
      this.__sendValue(x);
    }
  },
  __handleMainBoth: function(type, x) {
    if (type === 'value') {
      this.__lastValue = x;
    } else {
      this.__sendError(x);
    }
  },
  __onFirstIn: function() {
    WithSourceStreamMixin.__onFirstIn.call(this);
    this.__mainStream.onBoth(this.__handleMainBoth, this);
  },
  __onLastOut: function() {
    WithSourceStreamMixin.__onLastOut.call(this);
    this.__mainStream.offBoth(this.__handleMainBoth, this);
  },
  __clear: function() {
    WithSourceStreamMixin.__clear.call(this);
    this.__lastValue = null;
    this.__fn = null;
    this.__mainStream = null;
  }
}

SampledByMixin = extend({}, WithSourceStreamMixin, SampledByMixin);

var SampledByStream = function SampledByStream() {
  this.__Constructor.apply(this, arguments);
}

inherit(SampledByStream, Stream, SampledByMixin, {
  __ClassName: 'SampledByStream'
})

var SampledByProperty = function SampledByProperty() {
  this.__Constructor.apply(this, arguments);
}

inherit(SampledByProperty, Property, SampledByMixin, {
  __ClassName: 'SampledByProperty'
})

Observable.prototype.sampledBy = function(observable/*fn[, context[, arg1, arg2, ...]]*/) {
  if (observable instanceof Stream) {
    return new SampledByStream(this, observable, rest(arguments, 1));
  } else {
    return new SampledByProperty(this, observable, rest(arguments, 1));
  }
}

// TODO
//
// observable.flatMapFirst(f)
//
// observable.zip(other, f)
//
// observable.awaiting(otherObservable)
//
// stream.concat(otherStream)




var PluggableMixin = {

  __initPluggable: function() {
    this.__plugged = [];
  },
  __clearPluggable: function() {
    this.__plugged = null;
  },
  __handlePluggedBoth: function(type, value) {
    if (type === 'value') {
      this.__sendAny(value);
    } else {
      this.__sendError(value);
    }
  },
  __plug: function(stream) {
    if (this.alive) {
      this.__plugged.push(stream);
      if (this.active) {
        stream.onBoth(this.__handlePluggedBoth, this);
      }
      stream.onEnd('__unplug', this, stream);
    }
  },
  __unplug: function(stream) {
    if (this.alive) {
      for (var i = 0; i < this.__plugged.length; i++) {
        if (stream === this.__plugged[i]) {
          stream.offBoth(this.__handlePluggedBoth, this);
          stream.offEnd('__unplug', this, stream);
          this.__plugged.splice(i, 1);
          return;
        }
      }
    }
  },
  __onFirstIn: function() {
    for (var i = 0; i < this.__plugged.length; i++) {
      var stream = this.__plugged[i];
      if (stream) {
        stream.onBoth(this.__handlePluggedBoth, this);
      }
    }
  },
  __onLastOut: function() {
    for (var i = 0; i < this.__plugged.length; i++) {
      var stream = this.__plugged[i];
      if (stream) {
        stream.offBoth(this.__handlePluggedBoth, this);
      }
    }
  },
  __hasNoPlugged: function() {
    return !this.alive || this.__plugged.length === 0;
  }

}





// Kefir.bus()

var Bus = function Bus() {
  Stream.call(this);
  this.__initPluggable();
}

inherit(Bus, Stream, PluggableMixin, {

  __ClassName: 'Bus',

  push: function(x) {
    this.__sendAny(x);
    return this;
  },
  error: function(e) {
    this.__sendError(e);
    return this;
  },
  plug: function(stream) {
    this.__plug(stream);
    return this;
  },
  unplug: function(stream) {
    this.__unplug(stream);
    return this;
  },
  end: function() {
    this.__sendEnd();
    return this;
  },
  __clear: function() {
    Stream.prototype.__clear.call(this);
    this.__clearPluggable();
  }

});

Kefir.bus = function() {
  return new Bus();
}





// .flatMap()

var FlatMappedStream = function FlatMappedStream(sourceStream, mapFnMeta) {
  Stream.call(this);
  this.__initPluggable();
  this.__sourceStream = sourceStream;
  this.__mapFn = new Callable(mapFnMeta);
  sourceStream.onEnd(this.__onSourceEnds, this);
}

inherit(FlatMappedStream, Stream, PluggableMixin, {

  __ClassName: 'FlatMappedStream',

  __onSourceEnds: function() {
    if (this.__hasNoPlugged()) {
      this.__sendEnd();
    }
  },
  __plugResult: function(x) {
    this.__plug(Callable.call(this.__mapFn, [x]));
  },
  __hadleSourceBoth: function(type, x) {
    if (type === 'value') {
      this.__plugResult(x);
    } else {
      this.__sendError(x);
    }
  },
  __onFirstIn: function() {
    this.__sourceStream.onBoth(this.__hadleSourceBoth, this);
    PluggableMixin.__onFirstIn.call(this);
  },
  __onLastOut: function() {
    this.__sourceStream.offBoth(this.__hadleSourceBoth, this);
    PluggableMixin.__onLastOut.call(this);
  },
  __unplug: function(stream) {
    PluggableMixin.__unplug.call(this, stream);
    if (this.alive && this.__sourceStream.isEnded() && this.__hasNoPlugged()) {
      this.__sendEnd();
    }
  },
  __clear: function() {
    Stream.prototype.__clear.call(this);
    this.__clearPluggable();
    this.__sourceStream = null;
    this.__mapFn = null;
  }

})

Observable.prototype.flatMap = function(/*fn[, context[, arg1, arg2, ...]]*/) {
  return new FlatMappedStream(this, arguments);
};




// .flatMapLatest()

var FlatMapLatestStream = function FlatMapLatestStream() {
  FlatMappedStream.apply(this, arguments);
}

inherit(FlatMapLatestStream, FlatMappedStream, {

  __ClassName: 'FlatMapLatestStream',

  __plugResult: function(x) {
    if (this.__plugged.length === 1) {
      this.__unplug(this.__plugged[0]);
    }
    FlatMappedStream.prototype.__plugResult.call(this, x);
  }

})

Observable.prototype.flatMapLatest = function(/*fn[, context[, arg1, arg2, ...]]*/) {
  return new FlatMapLatestStream(this, arguments);
};




// .merge()

var MergedStream = function MergedStream() {
  Stream.call(this);
  this.__initPluggable();
  var sources = agrsToArray(arguments);
  for (var i = 0; i < sources.length; i++) {
    this.__plug(sources[i]);
  }
}

inherit(MergedStream, Stream, PluggableMixin, {

  __ClassName: 'MergedStream',

  __clear: function() {
    Stream.prototype.__clear.call(this);
    this.__clearPluggable();
  },
  __unplug: function(stream) {
    PluggableMixin.__unplug.call(this, stream);
    if (this.__hasNoPlugged()) {
      this.__sendEnd();
    }
  }

});

Kefir.merge = function() {
  return new MergedStream(agrsToArray(arguments));
}

Observable.prototype.merge = function() {
  return Kefir.merge([this].concat(agrsToArray(arguments)));
}









// .combine()

var CombinedStream = function CombinedStream(sources, mapFnMeta) {
  Stream.call(this);
  this.__plugged = sources;
  for (var i = 0; i < this.__plugged.length; i++) {
    sources[i].onEnd(this.__unplugById, this, i);
  }
  this.__cachedValues = new Array(sources.length);
  this.__hasValue = new Array(sources.length);
  this.__mapFn = mapFnMeta && new Callable(mapFnMeta);
}

inherit(CombinedStream, Stream, {

  __ClassName: 'CombinedStream',

  __onFirstIn: function() {
    for (var i = 0; i < this.__plugged.length; i++) {
      var stream = this.__plugged[i];
      if (stream) {
        stream.onBoth(this.__handlePluggedBoth, this, i);
      }
    }
  },
  __onLastOut: function() {
    for (var i = 0; i < this.__plugged.length; i++) {
      var stream = this.__plugged[i];
      if (stream) {
        stream.offBoth(this.__handlePluggedBoth, this, i);
      }
    }
  },
  __hasNoPlugged: function() {
    if (!this.alive) {
      return true;
    }
    for (var i = 0; i < this.__plugged.length; i++) {
      if (this.__plugged[i]) {
        return false;
      }
    }
    return true;
  },
  __unplugById: function(i) {
    var stream = this.__plugged[i];
    if (stream) {
      this.__plugged[i] = null;
      stream.offBoth(this.__handlePluggedBoth, this, i);
      stream.offEnd(this.__unplugById, this, i);
      if (this.__hasNoPlugged()) {
        this.__sendEnd();
      }
    }
  },
  __handlePluggedBoth: function(i, type, x) {
    if (type === 'value') {
      this.__hasValue[i] = true;
      this.__cachedValues[i] = x;
      if (this.__allCached()) {
        if (this.__mapFn) {
          this.__sendAny(Callable.call(this.__mapFn, this.__cachedValues));
        } else {
          this.__sendValue(this.__cachedValues.slice(0));
        }
      }
    } else {
      this.__sendError(x);
    }
  },
  __allCached: function() {
    for (var i = 0; i < this.__hasValue.length; i++) {
      if (!this.__hasValue[i]) {
        return false;
      }
    }
    return true;
  },
  __clear: function() {
    Stream.prototype.__clear.call(this);
    this.__plugged = null;
    this.__cachedValues = null;
    this.__hasValue = null;
    this.__mapFn = null;
  }

});

Kefir.combine = function(sources/*, fn[, context[, arg1, arg2, ...]]*/) {
  return new CombinedStream(sources, rest(arguments, 1));
}

Observable.prototype.combine = function(sources/*, fn[, context[, arg1, arg2, ...]]*/) {
  return new CombinedStream([this].concat(sources), rest(arguments, 1));
}






// Kefir.onValues()

Kefir.onValues = function(streams/*, fn[, context[, arg1, agr2, ...]]*/) {
  var fn = new Callable(rest(arguments, 1))
  return Kefir.combine(streams).onValue(function(xs) {
    return Callable.call(fn, xs);
  });
}

function createIntervalBasedStream(classNamePrefix, methodName, methods) {

  var defaultMethods = {
    __init: function(args) {},
    __free: function() {},
    __onTick: function() {}
  }

  var mixin = extend({
    __onFirstIn: function() {
      this.__intervalId = setInterval(this.__bindedOnTick, this.__wait);
    },
    __onLastOut: function() {
      if (this.__intervalId !== null) {
        clearInterval(this.__intervalId);
        this.__intervalId = null;
      }
    }
  }, defaultMethods, methods);

  function AnonymousIntervalBasedStream(wait, args) {
    Stream.call(this);
    this.__wait = wait;
    this.__intervalId = null;
    var _this = this;
    this.__bindedOnTick = function() {  _this.__onTick()  }
    this.__init(args);
  }

  inherit(AnonymousIntervalBasedStream, Stream, mixin, {
    __ClassName: classNamePrefix + 'Stream',
    __clear: function() {
      Stream.prototype.__clear.call(this);
      this.__bindedOnTick = null;
      this.__free();
    }
  });

  if (methodName) {
    Kefir[methodName] = function(wait) {
      return new AnonymousIntervalBasedStream(wait, rest(arguments, 1));
    }
  }

  return AnonymousIntervalBasedStream;

}




// Kefir.tiks()
// TODO: tests, docs

createIntervalBasedStream(
  'Tiks',
  'tiks',
  {
    __onTick: function() {
      this.__sendValue();
    }
  }
)




// Kefir.fromPoll()

createIntervalBasedStream(
  'FromPoll',
  'fromPoll',
  {
    __init: function(args) {
      this.__fn = new Callable(args);
    },
    __free: function() {
      this.__fn = null;
    },
    __onTick: function() {
      this.__sendAny(Callable.call(this.__fn));
    }
  }
)





// Kefir.interval()

createIntervalBasedStream(
  'Interval',
  'interval',
  {
    __init: function(args) {
      this.__x = args[0];
    },
    __free: function() {
      this.__x = null;
    },
    __onTick: function() {
      this.__sendAny(this.__x);
    }
  }
)






// Kefir.sequentially()

createIntervalBasedStream(
  'Sequentially',
  'sequentially',
  {
    __init: function(args) {
      this.__xs = args[0].slice(0);
    },
    __free: function() {
      this.__xs = null;
    },
    __onTick: function() {
      if (this.__xs.length === 0) {
        this.__sendEnd();
        return;
      }
      this.__sendAny(this.__xs.shift());
      if (this.__xs.length === 0) {
        this.__sendEnd();
      }
    }
  }
)





// Kefir.repeatedly()

createIntervalBasedStream(
  'Repeatedly',
  'repeatedly',
  {
    __init: function(args) {
      this.__xs = args[0].slice(0);
      this.__i = -1;
    },
    __onTick: function() {
      this.__i = (this.__i + 1) % this.__xs.length;
      this.__sendAny(this.__xs[this.__i]);
    }
  }
)






// Kefir.later()

createIntervalBasedStream(
  'Later',
  'later',
  {
    __init: function(args) {
      this.__x = args[0];
    },
    __free: function() {
      this.__x = null
    },
    __onTick: function() {
      this.__sendAny(this.__x);
      this.__sendEnd();
    }
  }
)

// TODO
//
// stream.bufferWithTime(delay)
// stream.bufferWithTime(f)
// stream.bufferWithCount(count)
// stream.bufferWithTimeOrCount(delay, count)

// TODO
//
// observable.mapError(f)
// observable.errors()
// observable.skipErrors()
// observable.endOnError(f)

// TODO
//
// observable.not()
// property.and(other)
// property.or(other)
//
// http://underscorejs.org/#pluck
// http://underscorejs.org/#invoke

// TODO
//
// Model = Bus + Property + lenses


  if (typeof define === 'function' && define.amd) {
    define([], function() {
      return Kefir;
    });
    global.Kefir = Kefir;
  } else if (typeof module === "object" && typeof exports === "object") {
    module.exports = Kefir;
    Kefir.Kefir = Kefir;
  } else {
    global.Kefir = Kefir;
  }

}(this));