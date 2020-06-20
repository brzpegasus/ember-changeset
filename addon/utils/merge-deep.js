import { Change } from 'validated-changeset';

function isMergeableObject(value) {
  return isNonNullObject(value) && !isSpecial(value);
}

function isNonNullObject(value) {
  return !!value && typeof value === 'object';
}

function isSpecial(value) {
  let stringValue = Object.prototype.toString.call(value);

  return stringValue === '[object RegExp]' || stringValue === '[object Date]';
}

function getEnumerableOwnPropertySymbols(target) {
  return Object.getOwnPropertySymbols
    ? Object.getOwnPropertySymbols(target).filter(symbol => {
      return Object.prototype.propertyIsEnumerable.call(target, symbol)
    })
    : [];
}

function getKeys(target) {
  return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target))
}

function propertyIsOnObject(object, property) {
  try {
    return property in object;
  } catch (_) {
    return false;
  }
}

// Ember Data models don't respond as expected to foo.hasOwnProperty, so we do a special check
function hasEmberDataProperty(target, key, options) {
  let fields = options.safeGet(target, 'constructor.fields');

  return fields instanceof Map && fields.has(key);
}

// Protects from prototype poisoning and unexpected merging up the prototype chain.
function propertyIsUnsafe(target, key, options) {
  if(hasEmberDataProperty(target, key, options)) {
    return false;
  }

  return propertyIsOnObject(target, key) // Properties are safe to merge if they don't exist in the target yet,
    && !(Object.prototype.hasOwnProperty.call(target, key) // unsafe if they exist up the prototype chain,
      && Object.prototype.propertyIsEnumerable.call(target, key)); // and also unsafe if they're nonenumerable.
}

/**
 * DFS - traverse depth first until find object with `value`.  Then go back up tree and try on next key
 * Need to exhaust all possible avenues.
 *
 * @method buildPathToValue
 */
function buildPathToValue(source, options, kv, possibleKeys) {
  Object.keys(source).forEach(key => {
    let possible = source[key];
    if (possible && Object.prototype.hasOwnProperty.call(possible, 'value')) {
      kv[[...possibleKeys, key].join('.')] = possible.value;
      return;
    }

    if (typeof possible === 'object') {
      buildPathToValue(possible, options, kv, [...possibleKeys, key]);
    }
  });

  return kv;
}

/**
 * `source` will always have a leaf key `value` with the property we want to set
 *
 * @method mergeTargetAndSource
 */
function mergeTargetAndSource(target, source, options) {
  getKeys(source).forEach(key => {
    // proto poisoning.  So can set by nested key path 'person.name'
    if (propertyIsUnsafe(target, key, options)) {
      // if safeSet, we will find keys leading up to value and set
      if (options.safeSet) {
        const kv = buildPathToValue(source, options, {}, []);
        // each key will be a path nested to the value `person.name.other`
        if (Object.keys(kv).length > 0) {
          // we found some keys!
          for (key in kv) {
            const val = kv[key];
            options.safeSet(target, key, val);
          }
        }
      }

      return;
    }

    // else safe key on object
    if (propertyIsOnObject(target, key) && isMergeableObject(source[key]) && !Object.prototype.hasOwnProperty.call(source[key], 'value')) {
      options.safeSet(target, key, mergeDeep(options.safeGet(target, key), options.safeGet(source, key), options));
    } else {
      let next = source[key];
      if (next && next instanceof Change) {
        return options.safeSet(target, key, next.value);
      }

      // if just some normal leaf value, then set
      return options.safeSet(target, key, next);
    }
  });

  return target;
}

/**
 * goal is to mutate target with source's properties, ensuring we dont encounter
 * pitfalls of { ..., ... } spread syntax overwriting keys on objects that we merged
 *
 * This is also adjusted for Ember peculiarities.  Specifically `options.setPath` will allows us
 * to handle properties on Proxy objects (that aren't the target's own property)
 *
 * @method mergeDeep
 */
export default function mergeDeep(target, source, options = {}) {
  options.safeGet = options.safeGet || function (obj, key) { return obj[key] };
  options.safeSet = options.safeSet || function(obj, key, value) { return obj[key] = value };
  let sourceIsArray = Array.isArray(source);
  let targetIsArray = Array.isArray(target);
  let sourceAndTargetTypesMatch = sourceIsArray === targetIsArray;

  if (!sourceAndTargetTypesMatch) {
    return source;
  } else if (sourceIsArray) {
    return source;
  } else {
    try {
      return mergeTargetAndSource(target, source, options);
    } catch(e) {
      throw new Error('Unable to `mergeDeep` with your data');
    }
  }
}
