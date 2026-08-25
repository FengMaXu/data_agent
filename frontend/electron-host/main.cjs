"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err2) => function __init() {
  if (err2) throw err2[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err2 = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/typebox/build/system/memory/metrics.mjs
var Metrics;
var init_metrics = __esm({
  "node_modules/typebox/build/system/memory/metrics.mjs"() {
    Metrics = {
      assign: 0,
      create: 0,
      clone: 0,
      discard: 0,
      update: 0
    };
  }
});

// node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return { ...left, ...right };
}
var init_assign = __esm({
  "node_modules/typebox/build/system/memory/assign.mjs"() {
    init_metrics();
  }
});

// node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && value[clusterEnd] === "\u200D") {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value);
}
function GraphemeCount(value) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count >= minLength)
      return true;
  }
  return false;
}
function IsMaxLength(value, maxLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count > maxLength)
      return false;
  }
  return true;
}
function IsMinLengthFast(value, minLength) {
  if (minLength === 0)
    return true;
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLength(value, minLength);
    }
    index++;
    if (index >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthFast(value, maxLength) {
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLength(value, maxLength);
    }
    index++;
    if (index > maxLength)
      return false;
  }
  return true;
}
var init_string = __esm({
  "node_modules/typebox/build/guard/string.mjs"() {
  }
});

// node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Symbols: () => Symbols,
  Values: () => Values
});
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLengthFast(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLengthFast(value, length);
}
function Every(value, offset, callback) {
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      return false;
  }
  return true;
}
function EveryAll(value, offset, callback) {
  let result = true;
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      result = false;
  }
  return result;
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}
var init_guard = __esm({
  "node_modules/typebox/build/guard/guard.mjs"() {
    init_string();
  }
});

// node_modules/typebox/build/guard/emit.mjs
var init_emit = __esm({
  "node_modules/typebox/build/guard/emit.mjs"() {
    init_guard();
  }
});

// node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}
var init_globals = __esm({
  "node_modules/typebox/build/guard/globals.mjs"() {
  }
});

// node_modules/typebox/build/guard/native.mjs
var init_native = __esm({
  "node_modules/typebox/build/guard/native.mjs"() {
    init_guard();
  }
});

// node_modules/typebox/build/guard/index.mjs
var guard_default;
var init_guard2 = __esm({
  "node_modules/typebox/build/guard/index.mjs"() {
    init_emit();
    init_globals();
    init_native();
    init_guard();
    init_guard();
    guard_default = guard_exports;
  }
});

// node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsTypeObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromTypeObject(value) {
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = descriptors[key];
    if (guard_exports.HasPropertyKey(descriptor, "value")) {
      Object.defineProperty(result, key, { ...descriptor, value: FromValue(descriptor.value) });
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsTypeObject(value) ? FromTypeObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}
var init_clone = __esm({
  "node_modules/typebox/build/system/memory/clone.mjs"() {
    init_guard2();
    init_metrics();
  }
});

// node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}
var settings;
var init_settings = __esm({
  "node_modules/typebox/build/system/settings/settings.mjs"() {
    init_guard2();
    settings = {
      immutableTypes: false,
      maxErrors: 8,
      useAcceleration: true,
      exactOptionalPropertyTypes: false,
      enumerableKind: false,
      correctiveParse: false,
      unionPrioritySort: true
    };
  }
});

// node_modules/typebox/build/system/settings/index.mjs
var init_settings2 = __esm({
  "node_modules/typebox/build/system/settings/index.mjs"() {
    init_settings();
  }
});

// node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const settings2 = settings_exports.Get();
  const withOptions = Merge(enumerable, options);
  const withHidden = settings2.enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return settings2.immutableTypes ? Object.freeze(withHidden) : withHidden;
}
var init_create = __esm({
  "node_modules/typebox/build/system/memory/create.mjs"() {
    init_settings2();
    init_metrics();
  }
});

// node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(Clone(value));
  const keysToDiscard = new Set(propertyKeys);
  for (const key of Object.keys(descriptors)) {
    if (keysToDiscard.has(key))
      continue;
    Object.defineProperty(result, key, descriptors[key]);
  }
  return result;
}
var init_discard = __esm({
  "node_modules/typebox/build/system/memory/discard.mjs"() {
    init_metrics();
    init_clone();
  }
});

// node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return result;
}
var init_update = __esm({
  "node_modules/typebox/build/system/memory/update.mjs"() {
    init_settings2();
    init_metrics();
    init_clone();
  }
});

// node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});
var init_memory = __esm({
  "node_modules/typebox/build/system/memory/memory.mjs"() {
    init_assign();
    init_clone();
    init_create();
    init_discard();
    init_metrics();
    init_update();
  }
});

// node_modules/typebox/build/system/memory/index.mjs
var init_memory2 = __esm({
  "node_modules/typebox/build/system/memory/index.mjs"() {
    init_memory();
  }
});

// node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema(value) {
  return guard_exports.IsObject(value);
}
var init_schema = __esm({
  "node_modules/typebox/build/type/types/schema.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}
var init_deferred = __esm({
  "node_modules/typebox/build/type/types/deferred.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddReadonlyAction(instantiatedType, options);
}
var init_instantiate_add = __esm({
  "node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs"() {
    init_memory2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddOptionalAction(instantiatedType, options);
}
var init_instantiate_add2 = __esm({
  "node_modules/typebox/build/type/engine/optional/instantiate_add.mjs"() {
    init_memory2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/types/array.mjs
function _Array_(items, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}
var init_array = __esm({
  "node_modules/typebox/build/type/types/array.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}
var init_constructor = __esm({
  "node_modules/typebox/build/type/types/constructor.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}
var init_function = __esm({
  "node_modules/typebox/build/type/types/function.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/ref.mjs
function Ref(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef(value) {
  return IsKind(value, "Ref");
}
var init_ref = __esm({
  "node_modules/typebox/build/type/types/ref.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}
var init_generic = __esm({
  "node_modules/typebox/build/type/types/generic.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}
var init_any = __esm({
  "node_modules/typebox/build/type/types/any.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/never.mjs
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}
var NeverPattern;
var init_never = __esm({
  "node_modules/typebox/build/type/types/never.mjs"() {
    init_memory2();
    init_schema();
    NeverPattern = "(?!)";
  }
});

// node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options = {}) {
  return Deferred("AddOptional", [type], options);
}
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}
var init_add_optional = __esm({
  "node_modules/typebox/build/type/action/_add_optional.mjs"() {
    init_deferred();
    init_instantiate_add2();
  }
});

// node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
}
var init_optional = __esm({
  "node_modules/typebox/build/type/types/_optional.mjs"() {
    init_guard2();
    init_schema();
    init_add_optional();
  }
});

// node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}
var init_properties = __esm({
  "node_modules/typebox/build/type/types/properties.mjs"() {
    init_guard2();
    init_optional();
  }
});

// node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}
var init_object = __esm({
  "node_modules/typebox/build/type/types/object.mjs"() {
    init_memory2();
    init_schema();
    init_properties();
  }
});

// node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}
var init_unknown = __esm({
  "node_modules/typebox/build/type/types/unknown.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}
var init_cyclic = __esm({
  "node_modules/typebox/build/type/types/cyclic.mjs"() {
    init_guard2();
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}
var init_unsafe = __esm({
  "node_modules/typebox/build/type/types/unsafe.mjs"() {
    init_guard2();
    init_memory2();
  }
});

// node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}
var init_arguments = __esm({
  "node_modules/typebox/build/system/arguments/arguments.mjs"() {
  }
});

// node_modules/typebox/build/system/arguments/index.mjs
var init_arguments2 = __esm({
  "node_modules/typebox/build/system/arguments/index.mjs"() {
    init_arguments();
  }
});

// node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}
var init_infer = __esm({
  "node_modules/typebox/build/type/types/infer.mjs"() {
    init_arguments2();
    init_memory2();
    init_schema();
    init_unknown();
  }
});

// node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}
var init_dependent = __esm({
  "node_modules/typebox/build/type/types/dependent.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}
var init_typescript_enum_to_enum_values = __esm({
  "node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
}
function IsEnum(value) {
  return IsKind(value, "Enum");
}
var init_enum = __esm({
  "node_modules/typebox/build/type/types/enum.mjs"() {
    init_guard2();
    init_memory2();
    init_schema();
    init_typescript_enum_to_enum_values();
    init_typescript_enum_to_enum_values();
  }
});

// node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}
var init_intersect = __esm({
  "node_modules/typebox/build/type/types/intersect.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/system/environment/evaluate.mjs
var init_evaluate = __esm({
  "node_modules/typebox/build/system/environment/evaluate.mjs"() {
    init_settings2();
    init_guard2();
  }
});

// node_modules/typebox/build/system/environment/environment.mjs
var init_environment = __esm({
  "node_modules/typebox/build/system/environment/environment.mjs"() {
    init_evaluate();
  }
});

// node_modules/typebox/build/system/environment/index.mjs
var init_environment2 = __esm({
  "node_modules/typebox/build/system/environment/index.mjs"() {
    init_environment();
  }
});

// node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}
var init_unreachable = __esm({
  "node_modules/typebox/build/system/unreachable/unreachable.mjs"() {
  }
});

// node_modules/typebox/build/system/unreachable/index.mjs
var init_unreachable2 = __esm({
  "node_modules/typebox/build/system/unreachable/index.mjs"() {
    init_unreachable();
  }
});

// node_modules/typebox/build/system/hashing/hash.mjs
var hash_exports = {};
__export(hash_exports, {
  Hash: () => Hash,
  HashCode: () => HashCode
});
function InstanceKeys(value) {
  const propertyKeys = /* @__PURE__ */ new Set();
  let current = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "constructor" && typeof key !== "symbol")
        propertyKeys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...propertyKeys];
}
function IsIEEE754(value) {
  return typeof value === "number";
}
function FNV1A64_OP(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Accumulator = Accumulator * Prime % Size;
}
function FromArray2(value) {
  FNV1A64_OP(ByteMarker.Array);
  for (const item of value) {
    FromValue2(item);
  }
}
function FromBigInt(value) {
  FNV1A64_OP(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromBoolean(value) {
  FNV1A64_OP(ByteMarker.Boolean);
  FNV1A64_OP(value ? 1 : 0);
}
function FromConstructor(value) {
  FNV1A64_OP(ByteMarker.Constructor);
  FromValue2(value.toString());
}
function FromDate(value) {
  FNV1A64_OP(ByteMarker.Date);
  FromValue2(value.getTime());
}
function FromFunction(value) {
  FNV1A64_OP(ByteMarker.Function);
  FromValue2(value.toString());
}
function FromNull(_value) {
  FNV1A64_OP(ByteMarker.Null);
}
function FromNumber(value) {
  FNV1A64_OP(ByteMarker.Number);
  F64In.setFloat64(
    0,
    value,
    true
    /* little-endian */
  );
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromObject2(value) {
  FNV1A64_OP(ByteMarker.Object);
  for (const key of InstanceKeys(value).sort()) {
    FromValue2(key);
    FromValue2(value[key]);
  }
}
function FromRegExp2(value) {
  FNV1A64_OP(ByteMarker.RegExp);
  FromString(value.toString());
}
function FromString(value) {
  FNV1A64_OP(ByteMarker.String);
  for (const byte of encoder.encode(value)) {
    FNV1A64_OP(byte);
  }
}
function FromSymbol(value) {
  FNV1A64_OP(ByteMarker.Symbol);
  FromValue2(value.toString());
}
function FromTypeArray(value) {
  FNV1A64_OP(ByteMarker.TypeArray);
  const buffer = new Uint8Array(value.buffer);
  for (let i = 0; i < buffer.length; i++) {
    FNV1A64_OP(buffer[i]);
  }
}
function FromUndefined(_value) {
  return FNV1A64_OP(ByteMarker.Undefined);
}
function FromValue2(value) {
  return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray2(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject2(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
}
function HashCode(value) {
  Accumulator = BigInt("14695981039346656037");
  FromValue2(value);
  return Accumulator;
}
function Hash(value) {
  return HashCode(value).toString(16).padStart(16, "0");
}
var ByteMarker, Accumulator, Prime, Size, Bytes, F64, F64In, F64Out, encoder;
var init_hash = __esm({
  "node_modules/typebox/build/system/hashing/hash.mjs"() {
    init_unreachable2();
    init_guard2();
    (function(ByteMarker2) {
      ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
      ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
      ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
      ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
      ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
      ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
      ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
      ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
      ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
      ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
      ByteMarker2[ByteMarker2["String"] = 10] = "String";
      ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
      ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
      ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
    })(ByteMarker || (ByteMarker = {}));
    Accumulator = BigInt("14695981039346656037");
    [Prime, Size] = [BigInt("1099511628211"), BigInt(
      "18446744073709551616"
      /* 2 ^ 64 */
    )];
    Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
    F64 = new Float64Array(1);
    F64In = new DataView(F64.buffer);
    F64Out = new Uint8Array(F64.buffer);
    encoder = new TextEncoder();
  }
});

// node_modules/typebox/build/system/hashing/index.mjs
var init_hashing = __esm({
  "node_modules/typebox/build/system/hashing/index.mjs"() {
    init_hash();
  }
});

// node_modules/typebox/build/system/locale/en_US.mjs
function en_US(error) {
  switch (error.keyword) {
    case "additionalProperties":
      return "must not have additional properties";
    case "anyOf":
      return "must match a schema in anyOf";
    case "boolean":
      return "schema is false";
    case "const":
      return "must be equal to constant";
    case "contains":
      return "must contain at least 1 valid item";
    case "dependencies":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "dependentRequired":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "enum":
      return "must be equal to one of the allowed values";
    case "exclusiveMaximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "exclusiveMinimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "format":
      return `must match format "${error.params.format}"`;
    case "if":
      return `must match "${error.params.failingKeyword}" schema`;
    case "maxItems":
      return `must not have more than ${error.params.limit} items`;
    case "maxLength":
      return `must not have more than ${error.params.limit} characters`;
    case "maxProperties":
      return `must not have more than ${error.params.limit} properties`;
    case "maximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "minItems":
      return `must not have fewer than ${error.params.limit} items`;
    case "minLength":
      return `must not have fewer than ${error.params.limit} characters`;
    case "minProperties":
      return `must not have fewer than ${error.params.limit} properties`;
    case "minimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "multipleOf":
      return `must be multiple of ${error.params.multipleOf}`;
    case "not":
      return "must not be valid";
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "pattern":
      return `must match pattern "${error.params.pattern}"`;
    case "propertyNames":
      return `property names ${error.params.propertyNames.join(", ")} are invalid`;
    case "required":
      return `must have required properties ${error.params.requiredProperties.join(", ")}`;
    case "type":
      return typeof error.params.type === "string" ? `must be ${error.params.type}` : `must be either ${error.params.type.join(" or ")}`;
    case "unevaluatedItems":
      return "must not have unevaluated items";
    case "unevaluatedProperties":
      return "must not have unevaluated properties";
    case "uniqueItems":
      return `must not have duplicate items`;
    case "~refine":
      return error.params.message;
    // deno-coverage-ignore - unreachable
    default:
      return "an unknown validation error occurred";
  }
}
var init_en_US = __esm({
  "node_modules/typebox/build/system/locale/en_US.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/_config.mjs
function Get2() {
  return locale;
}
var locale;
var init_config = __esm({
  "node_modules/typebox/build/system/locale/_config.mjs"() {
    init_en_US();
    locale = en_US;
  }
});

// node_modules/typebox/build/system/locale/ar_001.mjs
var init_ar_001 = __esm({
  "node_modules/typebox/build/system/locale/ar_001.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/bn_BD.mjs
var init_bn_BD = __esm({
  "node_modules/typebox/build/system/locale/bn_BD.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/cs_CZ.mjs
var init_cs_CZ = __esm({
  "node_modules/typebox/build/system/locale/cs_CZ.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/de_DE.mjs
var init_de_DE = __esm({
  "node_modules/typebox/build/system/locale/de_DE.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/el_GR.mjs
var init_el_GR = __esm({
  "node_modules/typebox/build/system/locale/el_GR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/es_419.mjs
var init_es_419 = __esm({
  "node_modules/typebox/build/system/locale/es_419.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/es_AR.mjs
var init_es_AR = __esm({
  "node_modules/typebox/build/system/locale/es_AR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/es_ES.mjs
var init_es_ES = __esm({
  "node_modules/typebox/build/system/locale/es_ES.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/es_MX.mjs
var init_es_MX = __esm({
  "node_modules/typebox/build/system/locale/es_MX.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/fa_IR.mjs
var init_fa_IR = __esm({
  "node_modules/typebox/build/system/locale/fa_IR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/fil_PH.mjs
var init_fil_PH = __esm({
  "node_modules/typebox/build/system/locale/fil_PH.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/fr_CA.mjs
var init_fr_CA = __esm({
  "node_modules/typebox/build/system/locale/fr_CA.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/fr_FR.mjs
var init_fr_FR = __esm({
  "node_modules/typebox/build/system/locale/fr_FR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ha_NG.mjs
var init_ha_NG = __esm({
  "node_modules/typebox/build/system/locale/ha_NG.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/hi_IN.mjs
var init_hi_IN = __esm({
  "node_modules/typebox/build/system/locale/hi_IN.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/hu_HU.mjs
var init_hu_HU = __esm({
  "node_modules/typebox/build/system/locale/hu_HU.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/id_ID.mjs
var init_id_ID = __esm({
  "node_modules/typebox/build/system/locale/id_ID.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/it_IT.mjs
var init_it_IT = __esm({
  "node_modules/typebox/build/system/locale/it_IT.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ja_JP.mjs
var init_ja_JP = __esm({
  "node_modules/typebox/build/system/locale/ja_JP.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ko_KR.mjs
var init_ko_KR = __esm({
  "node_modules/typebox/build/system/locale/ko_KR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ms_MY.mjs
var init_ms_MY = __esm({
  "node_modules/typebox/build/system/locale/ms_MY.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/nl_NL.mjs
var init_nl_NL = __esm({
  "node_modules/typebox/build/system/locale/nl_NL.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/pl_PL.mjs
var init_pl_PL = __esm({
  "node_modules/typebox/build/system/locale/pl_PL.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/pt_BR.mjs
var init_pt_BR = __esm({
  "node_modules/typebox/build/system/locale/pt_BR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/pt_PT.mjs
var init_pt_PT = __esm({
  "node_modules/typebox/build/system/locale/pt_PT.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ro_RO.mjs
var init_ro_RO = __esm({
  "node_modules/typebox/build/system/locale/ro_RO.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ru_RU.mjs
var init_ru_RU = __esm({
  "node_modules/typebox/build/system/locale/ru_RU.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/sv_SE.mjs
var init_sv_SE = __esm({
  "node_modules/typebox/build/system/locale/sv_SE.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/sw_TZ.mjs
var init_sw_TZ = __esm({
  "node_modules/typebox/build/system/locale/sw_TZ.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/th_TH.mjs
var init_th_TH = __esm({
  "node_modules/typebox/build/system/locale/th_TH.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/tr_TR.mjs
var init_tr_TR = __esm({
  "node_modules/typebox/build/system/locale/tr_TR.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/uk_UA.mjs
var init_uk_UA = __esm({
  "node_modules/typebox/build/system/locale/uk_UA.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/ur_PK.mjs
var init_ur_PK = __esm({
  "node_modules/typebox/build/system/locale/ur_PK.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/vi_VN.mjs
var init_vi_VN = __esm({
  "node_modules/typebox/build/system/locale/vi_VN.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/yo_NG.mjs
var init_yo_NG = __esm({
  "node_modules/typebox/build/system/locale/yo_NG.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/zh_Hans.mjs
var init_zh_Hans = __esm({
  "node_modules/typebox/build/system/locale/zh_Hans.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/zh_Hant.mjs
var init_zh_Hant = __esm({
  "node_modules/typebox/build/system/locale/zh_Hant.mjs"() {
  }
});

// node_modules/typebox/build/system/locale/_locale.mjs
var init_locale = __esm({
  "node_modules/typebox/build/system/locale/_locale.mjs"() {
    init_config();
    init_ar_001();
    init_bn_BD();
    init_cs_CZ();
    init_de_DE();
    init_el_GR();
    init_en_US();
    init_es_419();
    init_es_AR();
    init_es_ES();
    init_es_MX();
    init_fa_IR();
    init_fil_PH();
    init_fr_CA();
    init_fr_CA();
    init_fr_FR();
    init_ha_NG();
    init_hi_IN();
    init_hu_HU();
    init_id_ID();
    init_it_IT();
    init_ja_JP();
    init_ko_KR();
    init_ms_MY();
    init_nl_NL();
    init_pl_PL();
    init_pt_BR();
    init_pt_PT();
    init_ro_RO();
    init_ru_RU();
    init_sv_SE();
    init_sw_TZ();
    init_th_TH();
    init_tr_TR();
    init_uk_UA();
    init_ur_PK();
    init_vi_VN();
    init_yo_NG();
    init_zh_Hans();
    init_zh_Hant();
  }
});

// node_modules/typebox/build/system/locale/index.mjs
var init_locale2 = __esm({
  "node_modules/typebox/build/system/locale/index.mjs"() {
    init_locale();
  }
});

// node_modules/typebox/build/system/system.mjs
var init_system = __esm({
  "node_modules/typebox/build/system/system.mjs"() {
    init_arguments2();
    init_environment2();
    init_hashing();
    init_locale2();
    init_memory2();
    init_settings2();
  }
});

// node_modules/typebox/build/system/index.mjs
var init_system2 = __esm({
  "node_modules/typebox/build/system/index.mjs"() {
    init_system();
    init_system();
    init_system();
  }
});

// node_modules/typebox/build/type/types/_codec.mjs
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}
var EncodeBuilder, DecodeBuilder;
var init_codec = __esm({
  "node_modules/typebox/build/type/types/_codec.mjs"() {
    init_system2();
    init_guard2();
    init_schema();
    EncodeBuilder = class {
      constructor(type, decode) {
        this.type = type;
        this.decode = decode;
      }
      Encode(callback) {
        const type = this.type;
        const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
        const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
        const codec = { decode, encode };
        return memory_exports.Update(this.type, { "~codec": codec }, {});
      }
    };
    DecodeBuilder = class {
      constructor(type) {
        this.type = type;
      }
      Decode(callback) {
        return new EncodeBuilder(this.type, callback);
      }
    };
  }
});

// node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
}
var init_immutable = __esm({
  "node_modules/typebox/build/type/types/_immutable.mjs"() {
    init_guard2();
    init_schema();
    init_add_immutable();
  }
});

// node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options = {}) {
  return Deferred("AddReadonly", [type], options);
}
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}
var init_add_readonly = __esm({
  "node_modules/typebox/build/type/action/_add_readonly.mjs"() {
    init_deferred();
    init_instantiate_add();
  }
});

// node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
}
var init_readonly = __esm({
  "node_modules/typebox/build/type/types/_readonly.mjs"() {
    init_guard2();
    init_schema();
    init_add_readonly();
  }
});

// node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}
var init_refine = __esm({
  "node_modules/typebox/build/type/types/_refine.mjs"() {
    init_arguments2();
    init_memory2();
    init_guard2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/bigint.mjs
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}
var BigIntPattern;
var init_bigint = __esm({
  "node_modules/typebox/build/type/types/bigint.mjs"() {
    init_memory2();
    init_schema();
    BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
  }
});

// node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}
var init_boolean = __esm({
  "node_modules/typebox/build/type/types/boolean.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}
var init_identifier = __esm({
  "node_modules/typebox/build/type/types/identifier.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/integer.mjs
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}
var IntegerPattern;
var init_integer = __esm({
  "node_modules/typebox/build/type/types/integer.mjs"() {
    init_memory2();
    init_schema();
    IntegerPattern = "-?(?:0|[1-9][0-9]*)";
  }
});

// node_modules/typebox/build/type/types/literal.mjs
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralBigInt(value) {
  return IsLiteral(value) && guard_exports.IsBigInt(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral(value) && guard_exports.IsBoolean(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}
var InvalidLiteralValue;
var init_literal = __esm({
  "node_modules/typebox/build/type/types/literal.mjs"() {
    init_memory2();
    init_guard2();
    init_schema();
    InvalidLiteralValue = class extends Error {
      constructor(value) {
        super(`Invalid Literal value`);
        Object.defineProperty(this, "cause", {
          value: { value },
          writable: false,
          configurable: false,
          enumerable: false
        });
      }
    };
  }
});

// node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}
var init_null = __esm({
  "node_modules/typebox/build/type/types/null.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/number.mjs
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}
var NumberPattern;
var init_number = __esm({
  "node_modules/typebox/build/type/types/number.mjs"() {
    init_memory2();
    init_schema();
    NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
  }
});

// node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}
var init_symbol = __esm({
  "node_modules/typebox/build/type/types/symbol.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}
var init_parameter = __esm({
  "node_modules/typebox/build/type/types/parameter.mjs"() {
    init_arguments2();
    init_memory2();
    init_schema();
    init_unknown();
  }
});

// node_modules/typebox/build/type/types/string.mjs
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}
var StringPattern;
var init_string2 = __esm({
  "node_modules/typebox/build/type/types/string.mjs"() {
    init_memory2();
    init_schema();
    StringPattern = ".*";
  }
});

// node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}
var init_union = __esm({
  "node_modules/typebox/build/type/types/union.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}
var init_pattern = __esm({
  "node_modules/typebox/build/type/engine/patterns/pattern.mjs"() {
    init_guard2();
    init_parser();
  }
});

// node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}
var init_is_finite = __esm({
  "node_modules/typebox/build/type/engine/template_literal/is_finite.mjs"() {
    init_guard2();
    init_literal();
    init_union();
  }
});

// node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}
var init_create2 = __esm({
  "node_modules/typebox/build/type/engine/template_literal/create.mjs"() {
    init_memory2();
  }
});

// node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}
var init_decode = __esm({
  "node_modules/typebox/build/type/engine/template_literal/decode.mjs"() {
    init_guard2();
    init_unreachable2();
    init_literal();
    init_string2();
    init_template_literal();
    init_union();
    init_pattern();
    init_is_finite();
    init_create2();
  }
});

// node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}
var init_record_create = __esm({
  "node_modules/typebox/build/type/engine/record/record_create.mjs"() {
    init_memory2();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}
var init_from_key_any = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_any.mjs"() {
    init_record();
    init_record_create();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}
var init_from_key_boolean = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_boolean.mjs"() {
    init_object();
  }
});

// node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options = {}) {
  const [items, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}
var init_tuple = __esm({
  "node_modules/typebox/build/type/types/tuple.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveReadonlyAction(instantiatedType, options);
}
var init_instantiate_remove = __esm({
  "node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs"() {
    init_memory2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options = {}) {
  return Deferred("RemoveReadonly", [type], options);
}
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}
var init_remove_readonly = __esm({
  "node_modules/typebox/build/type/action/_remove_readonly.mjs"() {
    init_deferred();
    init_instantiate_remove();
  }
});

// node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveOptionalAction(instantiatedType, options);
}
var init_instantiate_remove2 = __esm({
  "node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs"() {
    init_memory2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options = {}) {
  return Deferred("RemoveOptional", [type], options);
}
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}
var init_remove_optional = __esm({
  "node_modules/typebox/build/type/action/_remove_optional.mjs"() {
    init_deferred();
    init_instantiate_remove2();
  }
});

// node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}
var init_to_object = __esm({
  "node_modules/typebox/build/type/engine/tuple/to_object.mjs"() {
    init_object();
  }
});

// node_modules/typebox/build/type/engine/evaluate/composite.mjs
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(right), ...guard_exports.Keys(left)]);
  return [...keys].reduce((result, key) => {
    return { ...result, [key]: CompositePropertyKey(left, right, key) };
  }, {});
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : Unreachable();
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  return _Object_(properties);
}
var init_composite = __esm({
  "node_modules/typebox/build/type/engine/evaluate/composite.mjs"() {
    init_unreachable2();
    init_guard2();
    init_readonly();
    init_optional();
    init_object();
    init_never();
    init_tuple();
    init_add_readonly();
    init_add_optional();
    init_remove_readonly();
    init_remove_optional();
    init_to_object();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function Narrow(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, ResultLeftInside) ? left : guard_exports.IsEqual(result, ResultRightInside) ? right : guard_exports.IsEqual(result, ResultEqual) ? right : Never();
}
var init_narrow = __esm({
  "node_modules/typebox/build/type/engine/evaluate/narrow.mjs"() {
    init_guard2();
    init_never();
    init_compare();
  }
});

// node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function IsObjectLike(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsUnionOperand(left, right) {
  const isUnionLeft = IsUnion(left);
  const isUnionRight = IsUnion(right);
  const result = isUnionLeft || isUnionRight;
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const isUnionOperand = IsUnionOperand(evaluatedLeft, evaluatedRight);
  const isObjectLeft = IsObjectLike(evaluatedLeft);
  const IsObjectRight = IsObjectLike(evaluatedRight);
  const result = isUnionOperand ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : isObjectLeft && IsObjectRight ? Composite(evaluatedLeft, evaluatedRight) : isObjectLeft && !IsObjectRight ? evaluatedLeft : !isObjectLeft && IsObjectRight ? evaluatedRight : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(type, left)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}
var init_distribute = __esm({
  "node_modules/typebox/build/type/engine/evaluate/distribute.mjs"() {
    init_guard2();
    init_union();
    init_object();
    init_tuple();
    init_composite();
    init_narrow();
    init_evaluate2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExcludeType(head, right)];
  }, []);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}
var init_operation = __esm({
  "node_modules/typebox/build/type/engine/exclude/operation.mjs"() {
    init_union();
    init_extends3();
    init_evaluate2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersect = Intersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersect, excluded]);
  return result;
}
function EvaluateEnum(values) {
  const result = values.map((value) => Literal(value));
  return EvaluateUnion(result);
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  return IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}
var init_evaluate2 = __esm({
  "node_modules/typebox/build/type/engine/evaluate/evaluate.mjs"() {
    init_guard2();
    init_dependent();
    init_enum();
    init_literal();
    init_intersect();
    init_never();
    init_template_literal();
    init_union();
    init_distribute();
    init_broaden();
    init_operation();
    init_decode();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}
var init_from_key_enum = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_enum.mjs"() {
    init_from_key();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}
var init_from_key_integer = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_integer.mjs"() {
    init_record();
    init_record_create();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}
var init_from_key_intersect = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_intersect.mjs"() {
    init_evaluate2();
    init_from_key();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}
var init_from_key_literal = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_literal.mjs"() {
    init_guard2();
    init_object();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}
var init_from_key_number = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_number.mjs"() {
    init_record();
    init_record_create();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}
var init_from_key_string = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_string.mjs"() {
    init_guard2();
    init_record();
    init_record_create();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}
var init_from_key_template_literal = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs"() {
    init_from_key();
    init_pattern();
    init_is_finite();
    init_evaluate2();
    init_record_create();
  }
});

// node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types) {
  return types.reduce((result, type) => {
    return [...result, ...FlattenType(type)];
  }, []);
}
var init_flatten = __esm({
  "node_modules/typebox/build/type/engine/evaluate/flatten.mjs"() {
    init_union();
  }
});

// node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record = TryBuildRecord(flattened, value);
  return IsSchema(record) ? record : CreateObject(flattened, value);
}
var init_from_key_union = __esm({
  "node_modules/typebox/build/type/engine/record/from_key_union.mjs"() {
    init_guard2();
    init_schema();
    init_literal();
    init_number();
    init_integer();
    init_object();
    init_string2();
    init_record();
    init_flatten();
    init_record_create();
  }
});

// node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}
var init_from_key = __esm({
  "node_modules/typebox/build/type/engine/record/from_key.mjs"() {
    init_any();
    init_boolean();
    init_enum();
    init_intersect();
    init_integer();
    init_literal();
    init_number();
    init_object();
    init_string2();
    init_template_literal();
    init_union();
    init_from_key_any();
    init_from_key_boolean();
    init_from_key_enum();
    init_from_key_integer();
    init_from_key_intersect();
    init_from_key_literal();
    init_from_key_number();
    init_from_key_string();
    init_from_key_template_literal();
    init_from_key_union();
  }
});

// node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context, state, key, value, options) {
  const instantiatedKey = InstantiateType(context, state, key);
  const instantiatedValue = InstantiateType(context, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}
var init_instantiate = __esm({
  "node_modules/typebox/build/type/engine/record/instantiate.mjs"() {
    init_memory2();
    init_record();
    init_from_key();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/types/record.mjs
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}
var IntegerKey, NumberKey, StringKey;
var init_record = __esm({
  "node_modules/typebox/build/type/types/record.mjs"() {
    init_memory2();
    init_guard2();
    init_schema();
    init_integer();
    init_number();
    init_string2();
    init_deferred();
    init_decode();
    init_record_create();
    init_instantiate();
    IntegerKey = `^${IntegerPattern}$`;
    NumberKey = `^${NumberPattern}$`;
    StringKey = `^${StringPattern}$`;
  }
});

// node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}
var init_rest = __esm({
  "node_modules/typebox/build/type/types/rest.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/static.mjs
var init_static = __esm({
  "node_modules/typebox/build/type/types/static.mjs"() {
  }
});

// node_modules/typebox/build/type/types/this.mjs
function This(options) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
}
function IsThis(value) {
  return IsKind(value, "This");
}
var init_this = __esm({
  "node_modules/typebox/build/type/types/this.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}
var init_undefined = __esm({
  "node_modules/typebox/build/type/types/undefined.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/void.mjs
function Void(options) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}
var init_void = __esm({
  "node_modules/typebox/build/type/types/void.mjs"() {
    init_memory2();
    init_schema();
  }
});

// node_modules/typebox/build/type/types/index.mjs
var init_types = __esm({
  "node_modules/typebox/build/type/types/index.mjs"() {
    init_codec();
    init_immutable();
    init_optional();
    init_readonly();
    init_refine();
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_call();
    init_constructor();
    init_cyclic();
    init_deferred();
    init_enum();
    init_function();
    init_generic();
    init_identifier();
    init_dependent();
    init_infer();
    init_integer();
    init_intersect();
    init_literal();
    init_never();
    init_null();
    init_number();
    init_unknown();
    init_symbol();
    init_object();
    init_parameter();
    init_properties();
    init_record();
    init_ref();
    init_rest();
    init_schema();
    init_static();
    init_string2();
    init_symbol();
    init_template_literal();
    init_this();
    init_tuple();
    init_undefined();
    init_union();
    init_unknown();
    init_unsafe();
    init_void();
  }
});

// node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[1]));
}
function ElementReadonlyMapping(input) {
  return AddReadonlyDeferred(input[1]);
}
function ElementOptionalMapping(input) {
  return AddOptionalDeferred(input[0]);
}
function ElementBaseMapping(input) {
  return input;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return PropertiesReduce(Delimited(input));
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const moduleDeclaration = input[0];
  const moduleDeclarationList = input[1];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, moduleDeclarationList[0]));
}
function ScriptMapping(input) {
  return input;
}
var DelimitedDecode, Delimited;
var init_mapping = __esm({
  "node_modules/typebox/build/type/script/mapping.mjs"() {
    init_memory2();
    init_guard2();
    init_types();
    init_action();
    DelimitedDecode = (input, result = []) => {
      return input.reduce((result2, left) => {
        return guard_exports.IsArray(left) && guard_exports.IsEqual(left.length, 2) ? [...result2, left[0]] : [...result2, left];
      }, []);
    };
    Delimited = (input) => {
      const [left, right] = input;
      return DelimitedDecode([...left, ...right]);
    };
  }
});

// node_modules/typebox/build/type/script/token/internal/guard.mjs
var init_guard3 = __esm({
  "node_modules/typebox/build/type/script/token/internal/guard.mjs"() {
    init_guard();
  }
});

// node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match2(input, ok2, fail) {
  return IsMatch(input) ? ok2(input[0], input[1]) : fail();
}
var init_match = __esm({
  "node_modules/typebox/build/type/script/token/internal/match.mjs"() {
    init_guard3();
  }
});

// node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}
var init_take = __esm({
  "node_modules/typebox/build/type/script/token/internal/take.mjs"() {
    init_match();
    init_guard3();
  }
});

// node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha, Zero, NonZero, Digit, WhiteSpace, NewLine, UnderScore, Dot, DollarSign, Hyphen;
var init_char = __esm({
  "node_modules/typebox/build/type/script/token/internal/char.mjs"() {
    Alpha = [
      ...Range(97, 122),
      // Lowercase
      ...Range(65, 90)
      // Uppercase
    ];
    Zero = "0";
    NonZero = Range(49, 57);
    Digit = [Zero, ...NonZero];
    WhiteSpace = " ";
    NewLine = "\n";
    UnderScore = "_";
    Dot = ".";
    DollarSign = "$";
    Hyphen = "-";
  }
});

// node_modules/typebox/build/type/script/token/internal/trim.mjs
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
var LineComment, OpenComment, CloseComment;
var init_trim = __esm({
  "node_modules/typebox/build/type/script/token/internal/trim.mjs"() {
    init_guard3();
    init_char();
    LineComment = "//";
    OpenComment = "/*";
    CloseComment = "*/";
  }
});

// node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}
var init_optional2 = __esm({
  "node_modules/typebox/build/type/script/token/internal/optional.mjs"() {
    init_match();
    init_take();
  }
});

// node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}
var init_many = __esm({
  "node_modules/typebox/build/type/script/token/internal/many.mjs"() {
    init_match();
    init_take();
  }
});

// node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}
var AllowedDigits;
var init_unsigned_integer = __esm({
  "node_modules/typebox/build/type/script/token/unsigned_integer.mjs"() {
    init_match();
    init_trim();
    init_take();
    init_many();
    init_char();
    init_char();
    init_char();
    init_char();
    AllowedDigits = [...Digit, UnderScore];
  }
});

// node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match2(
    TakeSign(input),
    (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}
var init_integer2 = __esm({
  "node_modules/typebox/build/type/script/token/integer.mjs"() {
    init_match();
    init_trim();
    init_optional2();
    init_char();
    init_unsigned_integer();
  }
});

// node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match2(
    Integer2(input),
    (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}
var init_bigint2 = __esm({
  "node_modules/typebox/build/type/script/token/bigint.mjs"() {
    init_match();
    init_take();
    init_integer2();
  }
});

// node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}
var init_const = __esm({
  "node_modules/typebox/build/type/script/token/const.mjs"() {
    init_guard3();
    init_trim();
    init_trim();
    init_take();
    init_char();
    init_char();
  }
});

// node_modules/typebox/build/type/script/token/ident.mjs
function TakeInitial(input) {
  return Take(Initial, input);
}
function TakeRemaining(input, result = "") {
  return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match2(
    TakeInitial(input),
    (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}
var Initial, Remaining;
var init_ident = __esm({
  "node_modules/typebox/build/type/script/token/ident.mjs"() {
    init_match();
    init_trim();
    init_take();
    init_char();
    init_char();
    init_char();
    init_char();
    Initial = [...Alpha, UnderScore, DollarSign];
    Remaining = [...Initial, ...Digit];
  }
});

// node_modules/typebox/build/type/script/token/unsigned_number.mjs
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match2(
    Take([Dot], input),
    (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match2(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match2(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}
var AllowedDigits2;
var init_unsigned_number = __esm({
  "node_modules/typebox/build/type/script/token/unsigned_number.mjs"() {
    init_guard3();
    init_match();
    init_trim();
    init_take();
    init_many();
    init_char();
    init_char();
    init_unsigned_integer();
    AllowedDigits2 = [...Digit, UnderScore];
  }
});

// node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match2(
    TakeSign2(input),
    (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}
var init_number2 = __esm({
  "node_modules/typebox/build/type/script/token/number.mjs"() {
    init_match();
    init_trim();
    init_optional2();
    init_char();
    init_unsigned_number();
  }
});

// node_modules/typebox/build/type/script/token/rest.mjs
var init_rest2 = __esm({
  "node_modules/typebox/build/type/script/token/rest.mjs"() {
    init_guard3();
  }
});

// node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match2(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}
var init_until = __esm({
  "node_modules/typebox/build/type/script/token/until.mjs"() {
    init_match();
    init_guard3();
  }
});

// node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}
var init_span = __esm({
  "node_modules/typebox/build/type/script/token/span.mjs"() {
    init_match();
    init_trim();
    init_char();
    init_take();
    init_until();
  }
});

// node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}
var init_string3 = __esm({
  "node_modules/typebox/build/type/script/token/string.mjs"() {
    init_match();
    init_take();
    init_trim();
    init_span();
  }
});

// node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}
var init_until_1 = __esm({
  "node_modules/typebox/build/type/script/token/until_1.mjs"() {
    init_guard3();
    init_match();
    init_until();
  }
});

// node_modules/typebox/build/type/script/token/index.mjs
var init_token = __esm({
  "node_modules/typebox/build/type/script/token/index.mjs"() {
    init_bigint2();
    init_const();
    init_ident();
    init_integer2();
    init_number2();
    init_rest2();
    init_span();
    init_string3();
    init_unsigned_integer();
    init_unsigned_number();
    init_until_1();
    init_until();
  }
});

// node_modules/typebox/build/type/script/parser.mjs
var If, GenericParameterExtendsEquals, GenericParameterExtends, GenericParameterEquals, GenericParameterIdentifier, GenericParameter, GenericParameterList_0, GenericParameterList, GenericParameters, GenericCallArgumentList_0, GenericCallArgumentList, GenericCallArguments, GenericCall, OptionalSemiColon, KeywordString, KeywordNumber, KeywordBoolean, KeywordUndefined, KeywordNull, KeywordInteger, KeywordBigInt, KeywordUnknown, KeywordAny, KeywordObject, KeywordNever, KeywordSymbol, KeywordVoid, KeywordThis, TemplateInterpolate, TemplateSpan, TemplateBody, TemplateLiteralTypes, TemplateLiteral, Dependent2, LiteralBigInt, LiteralBoolean, LiteralNumber, LiteralString, KeyOf, IndexArray_0, IndexArray, Extends2, Base, With, Factor, ExprTermTail, ExprTerm, ExprTail, Expr, ExprReadonly, ExprPipe, GenericType, InferType, Type, PropertyKeyNumber, PropertyKeyIdent, PropertyKeyQuoted, PropertyKeyIndex, PropertyKey, Readonly2, Optional3, Property, PropertyDelimiter, PropertyList_0, PropertyList, Properties, _Object_2, ElementNamed, ElementReadonlyOptional, ElementReadonly, ElementOptional, ElementBase, Element, ElementList_0, ElementList, _Tuple_, ParameterReadonlyOptional, ParameterReadonly, ParameterOptional, ParameterType, ParameterBase, Parameter2, ParameterList_0, ParameterList, _Function_2, _Constructor_, MappedReadonly, MappedOptional, MappedAs, _Mapped_, Reference, WithBigInt, WithNumber, WithBoolean, WithString, WithNull, WithUndefined, WithProperty, WithPropertyList_0, WithPropertyList, WithObject, WithElementList_0, WithElementList, WithArray, WithValue, PatternBigInt, PatternString, PatternNumber, PatternInteger, PatternNever, PatternText, PatternBase, PatternGroup, PatternUnion, PatternTerm, PatternBody, Pattern, InterfaceDeclarationHeritageList_0, InterfaceDeclarationHeritageList, InterfaceDeclarationHeritage, InterfaceDeclarationGeneric, InterfaceDeclaration, TypeAliasDeclarationGeneric, TypeAliasDeclaration, ExportKeyword, ModuleDeclarationDelimiter, ModuleDeclarationList_0, ModuleDeclarationList, ModuleDeclaration, Module, Script;
var init_parser = __esm({
  "node_modules/typebox/build/type/script/parser.mjs"() {
    init_mapping();
    init_token();
    If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
    GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
    GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
    GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
    GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
    GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
    GenericParameterList_0 = (input, result = []) => If(If(GenericParameter(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
    GenericParameterList = (input) => If(If(GenericParameterList_0(input), ([_0, input2]) => If(If(If(GenericParameter(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
    GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
    GenericCallArgumentList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
    GenericCallArgumentList = (input) => If(If(GenericCallArgumentList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
    GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
    GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
    OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
    KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
    KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
    KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
    KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
    KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
    KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
    KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
    KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
    KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
    KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
    KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
    KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
    KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
    KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
    TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
    TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
    TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
    TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
    TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
    Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
    LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
    LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
    LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
    LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
    KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
    IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
    IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
    Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
    Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
    With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
    Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
    ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
    ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
    ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
    Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
    ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
    ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
    GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
    InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
    Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
    PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
    PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
    PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
    PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
    PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
    Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
    Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
    Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
    PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
    PropertyList_0 = (input, result = []) => If(If(Property(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
    PropertyList = (input) => If(If(PropertyList_0(input), ([_0, input2]) => If(If(If(Property(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
    Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
    _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
    ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
    ElementReadonlyOptional = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ElementReadonlyOptionalMapping(_0), input2]);
    ElementReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementReadonlyMapping(_0), input2]);
    ElementOptional = (input) => If(If(Type(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementOptionalMapping(_0), input2]);
    ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonly(input), ([_0, input2]) => [_0, input2], () => If(ElementOptional(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
    Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
    ElementList_0 = (input, result = []) => If(If(Element(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
    ElementList = (input) => If(If(ElementList_0(input), ([_0, input2]) => If(If(If(Element(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementListMapping(_0), input2]);
    _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
    ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
    ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
    ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
    ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
    ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
    Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
    ParameterList_0 = (input, result = []) => If(If(Parameter2(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
    ParameterList = (input) => If(If(ParameterList_0(input), ([_0, input2]) => If(If(If(Parameter2(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
    _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
    _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
    MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
    MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
    MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
    _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
    Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
    WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
    WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
    WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
    WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
    WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
    WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
    WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
    WithPropertyList_0 = (input, result = []) => If(If(WithProperty(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
    WithPropertyList = (input) => If(If(WithPropertyList_0(input), ([_0, input2]) => If(If(If(WithProperty(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
    WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
    WithElementList_0 = (input, result = []) => If(If(WithValue(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
    WithElementList = (input) => If(If(WithElementList_0(input), ([_0, input2]) => If(If(If(WithValue(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
    WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
    WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
    PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
    PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
    PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
    PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
    PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
    PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
    PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
    PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
    PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
    PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
    PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
    Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
    InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
    InterfaceDeclarationHeritageList = (input) => If(If(InterfaceDeclarationHeritageList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
    InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
    InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
    InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
    TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
    TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
    ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
    ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
    ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
    ModuleDeclarationList = (input) => If(If(ModuleDeclarationList_0(input), ([_0, input2]) => If(If(If(ModuleDeclaration(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
    ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
    Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
    Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);
  }
});

// node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}
var init_template = __esm({
  "node_modules/typebox/build/type/engine/patterns/template.mjs"() {
    init_unreachable2();
    init_guard2();
    init_parser();
  }
});

// node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}
var init_encode = __esm({
  "node_modules/typebox/build/type/engine/template_literal/encode.mjs"() {
    init_guard2();
    init_enum();
    init_literal();
    init_union();
    init_template_literal();
    init_bigint();
    init_string2();
    init_number();
    init_integer();
    init_boolean();
    init_never();
    init_create2();
    init_evaluate2();
    init_instantiate2();
  }
});

// node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options) : TemplateLiteralDeferred(types, options);
  return result;
}
function TemplateLiteralInstantiate(context, state, types, options) {
  const instantiatedTypes = InstantiateTypes(context, state, types);
  return TemplateLiteralAction(instantiatedTypes, options);
}
var init_instantiate2 = __esm({
  "node_modules/typebox/build/type/engine/template_literal/instantiate.mjs"() {
    init_memory2();
    init_template_literal();
    init_encode();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options = {}) {
  return Deferred("TemplateLiteral", [types], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types) {
  return TemplateLiteralAction(types, {});
}
function TemplateLiteralFromString(template) {
  const types = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types);
}
function TemplateLiteral2(input, options = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}
var init_template_literal = __esm({
  "node_modules/typebox/build/type/types/template_literal.mjs"() {
    init_system();
    init_guard2();
    init_schema();
    init_deferred();
    init_template();
    init_instantiate2();
  }
});

// node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match3
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match3(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}
var init_result = __esm({
  "node_modules/typebox/build/type/extends/result.mjs"() {
    init_guard2();
    init_memory2();
  }
});

// node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}
var init_extends_right = __esm({
  "node_modules/typebox/build/type/extends/extends_right.mjs"() {
    init_guard2();
    init_memory2();
    init_any();
    init_dependent();
    init_enum();
    init_infer();
    init_intersect();
    init_template_literal();
    init_union();
    init_unknown();
    init_extends_left();
    init_result();
    init_evaluate2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}
var init_any2 = __esm({
  "node_modules/typebox/build/type/extends/any.mjs"() {
    init_infer();
    init_any();
    init_unknown();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}
var init_array2 = __esm({
  "node_modules/typebox/build/type/extends/array.mjs"() {
    init_array();
    init_immutable();
    init_extends_right();
    init_extends_left();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_bigint3 = __esm({
  "node_modules/typebox/build/type/extends/bigint.mjs"() {
    init_bigint();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_boolean2 = __esm({
  "node_modules/typebox/build/type/extends/boolean.mjs"() {
    init_boolean();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}
var init_parameters = __esm({
  "node_modules/typebox/build/type/extends/parameters.mjs"() {
    init_guard2();
    init_infer();
    init_optional();
    init_extends_left();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}
var init_return_type = __esm({
  "node_modules/typebox/build/type/extends/return_type.mjs"() {
    init_void();
    init_extends_left();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}
var init_constructor2 = __esm({
  "node_modules/typebox/build/type/extends/constructor.mjs"() {
    init_any();
    init_constructor();
    init_unknown();
    init_result();
    init_parameters();
    init_return_type();
  }
});

// node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}
var init_dependent2 = __esm({
  "node_modules/typebox/build/type/extends/dependent.mjs"() {
    init_extends_left();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}
var init_enum2 = __esm({
  "node_modules/typebox/build/type/extends/enum.mjs"() {
    init_extends_left();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}
var init_function2 = __esm({
  "node_modules/typebox/build/type/extends/function.mjs"() {
    init_any();
    init_function();
    init_unknown();
    init_result();
    init_parameters();
    init_return_type();
  }
});

// node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_integer3 = __esm({
  "node_modules/typebox/build/type/extends/integer.mjs"() {
    init_integer();
    init_number();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}
var init_intersect2 = __esm({
  "node_modules/typebox/build/type/extends/intersect.mjs"() {
    init_extends_left();
    init_evaluate3();
  }
});

// node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}
var init_literal2 = __esm({
  "node_modules/typebox/build/type/extends/literal.mjs"() {
    init_guard2();
    init_unreachable();
    init_literal();
    init_bigint();
    init_boolean();
    init_number();
    init_string2();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}
var init_never2 = __esm({
  "node_modules/typebox/build/type/extends/never.mjs"() {
    init_infer();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_null2 = __esm({
  "node_modules/typebox/build/type/extends/null.mjs"() {
    init_null();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_number3 = __esm({
  "node_modules/typebox/build/type/extends/number.mjs"() {
    init_number();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}
var init_object2 = __esm({
  "node_modules/typebox/build/type/extends/object.mjs"() {
    init_unreachable2();
    init_memory2();
    init_guard2();
    init_optional();
    init_infer();
    init_never();
    init_object();
    init_record();
    init_union();
    init_extends_left();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/record.mjs
function FromObject3(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject3(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}
var init_record2 = __esm({
  "node_modules/typebox/build/type/extends/record.mjs"() {
    init_guard2();
    init_any();
    init_unknown();
    init_object();
    init_record();
    init_extends_left();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_string4 = __esm({
  "node_modules/typebox/build/type/extends/string.mjs"() {
    init_string2();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_symbol2 = __esm({
  "node_modules/typebox/build/type/extends/symbol.mjs"() {
    init_symbol();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}
var init_template_literal2 = __esm({
  "node_modules/typebox/build/type/extends/template_literal.mjs"() {
    init_extends_left();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match3(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}
var init_inference = __esm({
  "node_modules/typebox/build/type/extends/inference.mjs"() {
    init_unreachable2();
    init_memory2();
    init_guard2();
    init_array();
    init_unknown();
    init_tuple();
    init_extends_left();
    init_union();
    init_infer();
    init_rest();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
  return IsSchema(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}
var init_tuple2 = __esm({
  "node_modules/typebox/build/type/extends/tuple.mjs"() {
    init_guard2();
    init_schema();
    init_array();
    init_tuple();
    init_extends_left();
    init_extends_right();
    init_result();
    init_instantiate27();
    init_instantiate27();
    init_inference();
  }
});

// node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_undefined2 = __esm({
  "node_modules/typebox/build/type/extends/undefined.mjs"() {
    init_undefined();
    init_void();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}
var init_union2 = __esm({
  "node_modules/typebox/build/type/extends/union.mjs"() {
    init_guard2();
    init_union();
    init_extends_left();
    init_result();
    init_inference();
  }
});

// node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}
var init_unknown2 = __esm({
  "node_modules/typebox/build/type/extends/unknown.mjs"() {
    init_any();
    init_unknown();
    init_infer();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}
var init_void2 = __esm({
  "node_modules/typebox/build/type/extends/void.mjs"() {
    init_void();
    init_extends_right();
    init_result();
  }
});

// node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}
var init_extends_left = __esm({
  "node_modules/typebox/build/type/extends/extends_left.mjs"() {
    init_any2();
    init_array2();
    init_bigint3();
    init_boolean2();
    init_constructor2();
    init_dependent2();
    init_enum2();
    init_function2();
    init_integer3();
    init_intersect2();
    init_literal2();
    init_never2();
    init_null2();
    init_number3();
    init_object2();
    init_record2();
    init_string4();
    init_symbol2();
    init_template_literal2();
    init_tuple2();
    init_undefined2();
    init_union2();
    init_unknown2();
    init_void2();
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_constructor();
    init_dependent();
    init_enum();
    init_function();
    init_integer();
    init_intersect();
    init_literal();
    init_never();
    init_null();
    init_number();
    init_object();
    init_record();
    init_string2();
    init_symbol();
    init_template_literal();
    init_tuple();
    init_undefined();
    init_unknown();
    init_union();
    init_void();
    init_result();
  }
});

// node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context, state, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context, state, heritage);
  const instantiatedProperties = InstantiateProperties(context, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}
var init_instantiate3 = __esm({
  "node_modules/typebox/build/type/engine/interface/instantiate.mjs"() {
    init_memory2();
    init_object();
    init_evaluate2();
    init_action();
    init_instantiate27();
    init_instantiate27();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options = {}) {
  return InterfaceAction(heritage, properties, options);
}
var init_interface = __esm({
  "node_modules/typebox/build/type/action/interface.mjs"() {
    init_guard2();
    init_schema();
    init_deferred();
    init_instantiate3();
  }
});

// node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context, types);
}
function FromTypes2(stack, context, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}
var init_check = __esm({
  "node_modules/typebox/build/type/engine/cyclic/check.mjs"() {
    init_guard2();
    init_array();
    init_constructor();
    init_function();
    init_intersect();
    init_object();
    init_properties();
    init_record();
    init_tuple();
    init_union();
    init_ref();
    init_interface();
  }
});

// node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}
var init_candidates = __esm({
  "node_modules/typebox/build/type/engine/cyclic/candidates.mjs"() {
    init_properties();
    init_check();
  }
});

// node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context, types, result);
}
function FromTypes3(context, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}
var init_dependencies = __esm({
  "node_modules/typebox/build/type/engine/cyclic/dependencies.mjs"() {
    init_unreachable2();
    init_array();
    init_constructor();
    init_function();
    init_intersect();
    init_object();
    init_properties();
    init_record();
    init_tuple();
    init_union();
    init_ref();
    init_interface();
  }
});

// node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}
var init_extends = __esm({
  "node_modules/typebox/build/type/engine/cyclic/extends.mjs"() {
    init_guard2();
    init_any();
    init_array();
    init_constructor();
    init_function();
    init_intersect();
    init_object();
    init_record();
    init_ref();
    init_tuple();
    init_union();
    init_unknown();
  }
});

// node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}
var init_instantiate4 = __esm({
  "node_modules/typebox/build/type/engine/cyclic/instantiate.mjs"() {
    init_guard2();
    init_cyclic();
    init_object();
    init_dependencies();
    init_action();
    init_instantiate27();
    init_instantiate27();
    init_instantiate27();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}
var init_target = __esm({
  "node_modules/typebox/build/type/engine/cyclic/target.mjs"() {
    init_never();
    init_ref();
  }
});

// node_modules/typebox/build/type/engine/cyclic/index.mjs
var init_cyclic2 = __esm({
  "node_modules/typebox/build/type/engine/cyclic/index.mjs"() {
    init_candidates();
    init_check();
    init_dependencies();
    init_extends();
    init_instantiate4();
    init_target();
  }
});

// node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}
var init_extends2 = __esm({
  "node_modules/typebox/build/type/extends/extends.mjs"() {
    init_cyclic();
    init_unknown();
    init_unsafe();
    init_extends_left();
    init_cyclic2();
  }
});

// node_modules/typebox/build/type/extends/index.mjs
var init_extends3 = __esm({
  "node_modules/typebox/build/type/extends/index.mjs"() {
    init_extends2();
    init_result();
  }
});

// node_modules/typebox/build/type/engine/evaluate/compare.mjs
function Compare(left, right) {
  const extendsCheck = [
    IsUnknown(left) ? result_exports.ExtendsFalse() : Extends({}, left, right),
    IsUnknown(left) ? result_exports.ExtendsTrue({}) : Extends({}, right, left)
  ];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? ResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultRightInside : ResultDisjoint;
}
var ResultEqual, ResultDisjoint, ResultLeftInside, ResultRightInside;
var init_compare = __esm({
  "node_modules/typebox/build/type/engine/evaluate/compare.mjs"() {
    init_unknown();
    init_extends3();
    ResultEqual = "equal";
    ResultDisjoint = "disjoint";
    ResultLeftInside = "left-inside";
    ResultRightInside = "right-inside";
  }
});

// node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadFilter(type, types) {
  return types.filter((left) => {
    return Compare(type, left) === ResultRightInside ? false : true;
  });
}
function IsBroadestType(type, types) {
  const result = types.some((left) => {
    const result2 = Compare(type, left);
    return guard_exports.IsEqual(result2, ResultLeftInside) || guard_exports.IsEqual(result2, ResultEqual);
  });
  return guard_exports.IsEqual(result, false);
}
function BroadenType(type, types) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : IsBroadestType(evaluated, types) ? [...BroadFilter(evaluated, types), evaluated] : types;
}
function BroadenTypes(types) {
  return types.reduce((result, left) => {
    return IsObject2(left) ? [...result, left] : (
      // push
      IsNever(left) ? result : (
        // ignore
        BroadenType(left, result)
      )
    );
  }, []);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}
var init_broaden = __esm({
  "node_modules/typebox/build/type/engine/evaluate/broaden.mjs"() {
    init_guard2();
    init_any();
    init_never();
    init_object();
    init_compare();
    init_flatten();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return EvaluateAction(instantiatedType, options);
}
var init_instantiate5 = __esm({
  "node_modules/typebox/build/type/engine/evaluate/instantiate.mjs"() {
    init_memory2();
    init_instantiate27();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/evaluate/index.mjs
var init_evaluate3 = __esm({
  "node_modules/typebox/build/type/engine/evaluate/index.mjs"() {
    init_broaden();
    init_compare();
    init_composite();
    init_distribute();
    init_evaluate2();
    init_flatten();
    init_instantiate5();
    init_narrow();
  }
});

// node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function Expand(type) {
  return IsUnion(type) ? [...type.anyOf] : [type];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}
var init_distribute_arguments = __esm({
  "node_modules/typebox/build/type/engine/call/distribute_arguments.mjs"() {
    init_guard2();
    init_union();
    init_deferred();
    init_ref();
  }
});

// node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}
var init_resolve_target = __esm({
  "node_modules/typebox/build/type/engine/call/resolve_target.mjs"() {
    init_generic();
    init_ref();
    init_never();
  }
});

// node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state, parameters, arguments_) {
  return BindParameters(context, state, parameters, arguments_);
}
var init_resolve_arguments = __esm({
  "node_modules/typebox/build/type/engine/call/resolve_arguments.mjs"() {
    init_guard2();
    init_memory2();
    init_instantiate27();
    init_extends3();
    init_infer();
    init_call();
  }
});

// node_modules/typebox/build/type/engine/call/instantiate.mjs
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context, state, target, parameters, expression, arguments_) {
  const argumentsContext = ResolveArgumentsContext(context, state, parameters, arguments_);
  const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
  return InstantiateType(argumentsContext, State([], []), returnType);
}
function CallDistributed(context, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => [...result, CallDispatch(context, state, target, parameters, expression, arguments_)], []);
}
function CallImmediate(context, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state, arguments_);
  const resolved = ResolveTarget(context, target, arguments_);
  const name = resolved[0];
  const type = resolved[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state, Ref(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}
var init_instantiate6 = __esm({
  "node_modules/typebox/build/type/engine/call/instantiate.mjs"() {
    init_guard2();
    init_call();
    init_ref();
    init_generic();
    init_evaluate3();
    init_instantiate27();
    init_instantiate27();
    init_instantiate27();
    init_distribute_arguments();
    init_resolve_target();
    init_resolve_arguments();
  }
});

// node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}
var init_call = __esm({
  "node_modules/typebox/build/type/types/call.mjs"() {
    init_memory2();
    init_schema();
    init_instantiate6();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveImmutableAction(instantiatedType, options);
}
var init_instantiate_remove3 = __esm({
  "node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs"() {
    init_memory2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}
var init_mapping2 = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/mapping.mjs"() {
  }
});

// node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}
var init_from_literal = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs"() {
    init_guard2();
    init_literal();
    init_mapping2();
  }
});

// node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}
var init_from_template_literal = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs"() {
    init_from_type();
    init_evaluate3();
  }
});

// node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}
var init_from_union = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/from_union.mjs"() {
    init_union();
    init_from_type();
  }
});

// node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}
var init_from_type = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/from_type.mjs"() {
    init_literal();
    init_template_literal();
    init_union();
    init_from_literal();
    init_from_template_literal();
    init_from_union();
  }
});

// node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}
function Capitalize(type, options = {}) {
  return CapitalizeAction(type, options);
}
var init_capitalize = __esm({
  "node_modules/typebox/build/type/action/capitalize.mjs"() {
    init_deferred();
    init_instantiate7();
  }
});

// node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}
function Lowercase(type, options = {}) {
  return LowercaseAction(type, options);
}
var init_lowercase = __esm({
  "node_modules/typebox/build/type/action/lowercase.mjs"() {
    init_deferred();
    init_instantiate7();
  }
});

// node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}
function Uncapitalize(type, options = {}) {
  return UncapitalizeAction(type, options);
}
var init_uncapitalize = __esm({
  "node_modules/typebox/build/type/action/uncapitalize.mjs"() {
    init_deferred();
    init_instantiate7();
  }
});

// node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}
function Uppercase(type, options = {}) {
  return UppercaseAction(type, options);
}
var init_uppercase = __esm({
  "node_modules/typebox/build/type/action/uppercase.mjs"() {
    init_deferred();
    init_instantiate7();
  }
});

// node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UppercaseAction(instantiatedType, options);
}
var CapitalizeMapping, LowercaseMapping, UncapitalizeMapping, UppercaseMapping;
var init_instantiate7 = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs"() {
    init_memory2();
    init_from_type();
    init_instantiate27();
    init_capitalize();
    init_lowercase();
    init_uncapitalize();
    init_uppercase();
    CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
    LowercaseMapping = (input) => input.toLowerCase();
    UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
    UppercaseMapping = (input) => input.toUpperCase();
  }
});

// node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}
function Conditional(left, right, true_, false_, options = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options);
}
var init_conditional = __esm({
  "node_modules/typebox/build/type/action/conditional.mjs"() {
    init_deferred();
    init_instantiate8();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context, state, false_);
}
function ConditionalAction(context, state, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context, state, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ConditionalAction(context, state, instantiatedLeft, instantiatedRight, true_, false_, options);
}
var init_instantiate8 = __esm({
  "node_modules/typebox/build/type/engine/conditional/instantiate.mjs"() {
    init_memory2();
    init_union();
    init_extends3();
    init_instantiate27();
    init_conditional();
  }
});

// node_modules/typebox/build/type/engine/conditional/index.mjs
var init_conditional2 = __esm({
  "node_modules/typebox/build/type/engine/conditional/index.mjs"() {
    init_instantiate8();
  }
});

// node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}
function ConstructorParameters(type, options = {}) {
  return ConstructorParametersAction(type, options);
}
var init_constructor_parameters = __esm({
  "node_modules/typebox/build/type/action/constructor_parameters.mjs"() {
    init_deferred();
    init_instantiate9();
  }
});

// node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ConstructorParametersAction(instantiatedType, options);
}
var init_instantiate9 = __esm({
  "node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs"() {
    init_memory2();
    init_constructor();
    init_tuple();
    init_constructor_parameters();
    init_instantiate27();
    init_instantiate27();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}
function Exclude(left, right, options = {}) {
  return ExcludeAction(left, right, options);
}
var init_exclude = __esm({
  "node_modules/typebox/build/type/action/exclude.mjs"() {
    init_deferred();
    init_instantiate10();
  }
});

// node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}
var init_instantiate10 = __esm({
  "node_modules/typebox/build/type/engine/exclude/instantiate.mjs"() {
    init_memory2();
    init_instantiate27();
    init_exclude();
    init_operation();
  }
});

// node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}
function Extract(left, right, options = {}) {
  return ExtractAction(left, right, options);
}
var init_extract = __esm({
  "node_modules/typebox/build/type/action/extract.mjs"() {
    init_deferred();
    init_instantiate11();
  }
});

// node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExtractType(head, right)];
  }, []);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}
var init_operation2 = __esm({
  "node_modules/typebox/build/type/engine/extract/operation.mjs"() {
    init_union();
    init_extends3();
    init_evaluate2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}
var init_instantiate11 = __esm({
  "node_modules/typebox/build/type/engine/extract/instantiate.mjs"() {
    init_memory2();
    init_instantiate27();
    init_extract();
    init_operation2();
  }
});

// node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}
var init_keys_to_indexer = __esm({
  "node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs"() {
    init_literal();
    init_union();
  }
});

// node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}
function Index(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options);
}
var init_indexed = __esm({
  "node_modules/typebox/build/type/action/indexed.mjs"() {
    init_guard2();
    init_deferred();
    init_keys_to_indexer();
    init_instantiate12();
  }
});

// node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}
var init_from_cyclic = __esm({
  "node_modules/typebox/build/type/engine/object/from_cyclic.mjs"() {
    init_from_type2();
    init_target();
  }
});

// node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}
var init_from_dependent = __esm({
  "node_modules/typebox/build/type/engine/object/from_dependent.mjs"() {
    init_from_type2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}
var init_from_intersect = __esm({
  "node_modules/typebox/build/type/engine/object/from_intersect.mjs"() {
    init_memory2();
    init_guard2();
    init_from_type2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject4(properties) {
  return properties;
}
var init_from_object = __esm({
  "node_modules/typebox/build/type/engine/object/from_object.mjs"() {
  }
});

// node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}
var init_from_tuple = __esm({
  "node_modules/typebox/build/type/engine/object/from_tuple.mjs"() {
    init_tuple();
    init_to_object();
    init_from_type2();
  }
});

// node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}
var init_from_union2 = __esm({
  "node_modules/typebox/build/type/engine/object/from_union.mjs"() {
    init_guard2();
    init_unreachable2();
    init_evaluate2();
    init_from_type2();
  }
});

// node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject4(type.properties) : {};
}
var init_from_type2 = __esm({
  "node_modules/typebox/build/type/engine/object/from_type.mjs"() {
    init_cyclic();
    init_dependent();
    init_intersect();
    init_object();
    init_tuple();
    init_union();
    init_from_cyclic();
    init_from_dependent();
    init_from_intersect();
    init_from_object();
    init_from_tuple();
    init_from_union2();
  }
});

// node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}
var init_collapse = __esm({
  "node_modules/typebox/build/type/engine/object/collapse.mjs"() {
    init_object();
    init_from_type2();
  }
});

// node_modules/typebox/build/type/engine/object/index.mjs
var init_object3 = __esm({
  "node_modules/typebox/build/type/engine/object/index.mjs"() {
    init_collapse();
  }
});

// node_modules/typebox/build/type/engine/helpers/keys.mjs
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}
var integerKeyPattern;
var init_keys = __esm({
  "node_modules/typebox/build/type/engine/helpers/keys.mjs"() {
    integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
  }
});

// node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray3(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}
var init_from_array = __esm({
  "node_modules/typebox/build/type/engine/indexed/from_array.mjs"() {
    init_guard2();
    init_intersect();
    init_union();
    init_literal();
    init_number();
    init_never();
    init_extends3();
    init_keys();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}
var init_from_cyclic2 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs"() {
    init_from_type3();
    init_target();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}
var init_from_dependent2 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_dependent.mjs"() {
    init_from_type3();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}
var init_from_enum = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_enum.mjs"() {
    init_from_type3();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}
var init_from_intersect2 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_intersect.mjs"() {
    init_evaluate2();
    init_from_type3();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}
var init_from_literal2 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_literal.mjs"() {
  }
});

// node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}
var init_from_template_literal2 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs"() {
    init_from_type3();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}
var init_from_union3 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_union.mjs"() {
    init_from_type3();
  }
});

// node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}
var init_from_type3 = __esm({
  "node_modules/typebox/build/type/engine/indexable/from_type.mjs"() {
    init_cyclic();
    init_dependent();
    init_enum();
    init_intersect();
    init_literal();
    init_template_literal();
    init_union();
    init_from_cyclic2();
    init_from_dependent2();
    init_from_enum();
    init_from_intersect2();
    init_from_literal2();
    init_from_template_literal2();
    init_from_union3();
  }
});

// node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}
var init_to_indexable_keys = __esm({
  "node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs"() {
    init_from_type3();
  }
});

// node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}
var init_expand_this = __esm({
  "node_modules/typebox/build/type/engine/this/expand_this.mjs"() {
    init_array();
    init_constructor();
    init_function();
    init_intersect();
    init_object();
    init_tuple();
    init_this();
    init_union();
  }
});

// node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject5(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}
var NumericKeyPattern;
var init_from_object2 = __esm({
  "node_modules/typebox/build/type/engine/indexed/from_object.mjs"() {
    init_number();
    init_never();
    init_properties();
    init_evaluate2();
    init_to_indexable_keys();
    init_record();
    init_expand_this();
    NumericKeyPattern = new RegExp(IntegerKey);
  }
});

// node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}
var init_array_indexer = __esm({
  "node_modules/typebox/build/type/engine/indexed/array_indexer.mjs"() {
    init_union();
    init_intersect();
    init_literal();
    init_keys();
  }
});

// node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}
var init_from_tuple2 = __esm({
  "node_modules/typebox/build/type/engine/indexed/from_tuple.mjs"() {
    init_guard2();
    init_literal();
    init_number();
    init_integer();
    init_evaluate2();
    init_extends3();
    init_array_indexer();
  }
});

// node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray3(type.items, indexer) : IsObject2(type) ? FromObject5(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}
var init_from_type4 = __esm({
  "node_modules/typebox/build/type/engine/indexed/from_type.mjs"() {
    init_array();
    init_never();
    init_object();
    init_tuple();
    init_from_array();
    init_from_object2();
    init_from_tuple2();
  }
});

// node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}
var init_instantiate12 = __esm({
  "node_modules/typebox/build/type/engine/indexed/instantiate.mjs"() {
    init_memory2();
    init_cyclic();
    init_dependent();
    init_intersect();
    init_union();
    init_instantiate27();
    init_indexed();
    init_object3();
    init_from_type4();
  }
});

// node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}
function InstanceType(type, options = {}) {
  return InstanceTypeAction(type, options);
}
var init_instance_type = __esm({
  "node_modules/typebox/build/type/action/instance_type.mjs"() {
    init_deferred();
    init_instantiate13();
  }
});

// node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return InstanceTypeAction(instantiatedType, options);
}
var init_instantiate13 = __esm({
  "node_modules/typebox/build/type/engine/instance_type/instantiate.mjs"() {
    init_memory2();
    init_constructor();
    init_never();
    init_instance_type();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}
function KeyOf2(type, options = {}) {
  return KeyOfAction(type, options);
}
var init_keyof = __esm({
  "node_modules/typebox/build/type/action/keyof.mjs"() {
    init_deferred();
    init_instantiate14();
  }
});

// node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}
var init_from_any = __esm({
  "node_modules/typebox/build/type/engine/keyof/from_any.mjs"() {
    init_number();
    init_string2();
    init_symbol();
    init_union();
  }
});

// node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray4(_type) {
  return Number2();
}
var init_from_array2 = __esm({
  "node_modules/typebox/build/type/engine/keyof/from_array.mjs"() {
    init_number();
  }
});

// node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject6(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}
var init_from_object3 = __esm({
  "node_modules/typebox/build/type/engine/keyof/from_object.mjs"() {
    init_unreachable2();
    init_guard2();
    init_literal();
    init_keys();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}
var init_from_record = __esm({
  "node_modules/typebox/build/type/engine/keyof/from_record.mjs"() {
    init_record();
  }
});

// node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}
var init_from_tuple3 = __esm({
  "node_modules/typebox/build/type/engine/keyof/from_tuple.mjs"() {
    init_literal();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray4(type.items) : IsObject2(type) ? FromObject6(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}
var init_from_type5 = __esm({
  "node_modules/typebox/build/type/engine/keyof/from_type.mjs"() {
    init_any();
    init_array();
    init_never();
    init_object();
    init_record();
    init_tuple();
    init_from_any();
    init_from_array2();
    init_from_object3();
    init_from_record();
    init_from_tuple3();
  }
});

// node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return KeyOfAction(instantiatedType, options);
}
var init_instantiate14 = __esm({
  "node_modules/typebox/build/type/engine/keyof/instantiate.mjs"() {
    init_memory2();
    init_cyclic();
    init_dependent();
    init_intersect();
    init_union();
    init_keyof();
    init_instantiate27();
    init_object3();
    init_from_type5();
  }
});

// node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}
function Mapped(identifier, type, as, property, options = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options);
}
var init_mapped = __esm({
  "node_modules/typebox/build/type/action/mapped.mjs"() {
    init_deferred();
    init_instantiate15();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}
var init_mapped_variants = __esm({
  "node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs"() {
    init_guard2();
    init_literal();
    init_enum();
    init_template_literal();
    init_union();
    init_evaluate2();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}
var init_mapped_operation = __esm({
  "node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs"() {
    init_memory2();
    init_literal();
    init_object();
    init_template_literal();
    init_instantiate27();
    init_evaluate2();
    init_evaluate2();
    init_mapped_variants();
  }
});

// node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context, state, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return MappedAction(context, state, identifier, instantiatedType, as, property, options);
}
var init_instantiate15 = __esm({
  "node_modules/typebox/build/type/engine/mapped/instantiate.mjs"() {
    init_memory2();
    init_mapped();
    init_instantiate27();
    init_mapped_operation();
  }
});

// node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context, declarations, options);
  return instantiatedModule;
}
var init_instantiate16 = __esm({
  "node_modules/typebox/build/type/engine/module/instantiate.mjs"() {
    init_guard2();
    init_memory2();
    init_instantiate27();
    init_candidates();
    init_instantiate4();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}
function NonNullable(type, options = {}) {
  return NonNullableAction(type, options);
}
var init_non_nullable = __esm({
  "node_modules/typebox/build/type/action/non_nullable.mjs"() {
    init_deferred();
    init_instantiate17();
  }
});

// node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return NonNullableAction(instantiatedType, options);
}
var init_instantiate17 = __esm({
  "node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs"() {
    init_memory2();
    init_null();
    init_undefined();
    init_union();
    init_instantiate10();
    init_non_nullable();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}
function Omit(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options);
}
var init_omit = __esm({
  "node_modules/typebox/build/type/action/omit.mjs"() {
    init_guard2();
    init_deferred();
    init_keys_to_indexer();
    init_instantiate18();
  }
});

// node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}
var init_to_indexable = __esm({
  "node_modules/typebox/build/type/engine/indexable/to_indexable.mjs"() {
    init_unreachable2();
    init_object();
    init_object3();
  }
});

// node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}
var init_from_type6 = __esm({
  "node_modules/typebox/build/type/engine/omit/from_type.mjs"() {
    init_guard2();
    init_object();
    init_to_indexable_keys();
    init_to_indexable();
  }
});

// node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}
var init_instantiate18 = __esm({
  "node_modules/typebox/build/type/engine/omit/instantiate.mjs"() {
    init_memory2();
    init_omit();
    init_instantiate27();
    init_from_type6();
  }
});

// node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}
function Parameters(type, options = {}) {
  return ParametersAction(type, options);
}
var init_parameters2 = __esm({
  "node_modules/typebox/build/type/action/parameters.mjs"() {
    init_deferred();
    init_instantiate19();
  }
});

// node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ParametersAction(instantiatedType, options);
}
var init_instantiate19 = __esm({
  "node_modules/typebox/build/type/engine/parameters/instantiate.mjs"() {
    init_memory2();
    init_function();
    init_tuple();
    init_parameters2();
    init_instantiate27();
    init_instantiate27();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}
function Partial(type, options = {}) {
  return PartialAction(type, options);
}
var init_partial = __esm({
  "node_modules/typebox/build/type/action/partial.mjs"() {
    init_deferred();
    init_instantiate20();
  }
});

// node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}
var init_from_cyclic3 = __esm({
  "node_modules/typebox/build/type/engine/partial/from_cyclic.mjs"() {
    init_memory2();
    init_cyclic();
    init_from_type7();
    init_target();
  }
});

// node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}
var init_from_dependent3 = __esm({
  "node_modules/typebox/build/type/engine/partial/from_dependent.mjs"() {
    init_from_type7();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}
var init_from_intersect3 = __esm({
  "node_modules/typebox/build/type/engine/partial/from_intersect.mjs"() {
    init_from_type7();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}
var init_from_union4 = __esm({
  "node_modules/typebox/build/type/engine/partial/from_union.mjs"() {
    init_union();
    init_from_type7();
  }
});

// node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject7(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}
var init_from_object4 = __esm({
  "node_modules/typebox/build/type/engine/partial/from_object.mjs"() {
    init_guard2();
    init_object();
    init_add_optional();
  }
});

// node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject7(type.properties) : _Object_({});
}
var init_from_type7 = __esm({
  "node_modules/typebox/build/type/engine/partial/from_type.mjs"() {
    init_cyclic();
    init_dependent();
    init_intersect();
    init_object();
    init_union();
    init_from_cyclic3();
    init_from_dependent3();
    init_from_intersect3();
    init_from_union4();
    init_from_object4();
  }
});

// node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return PartialAction(instantiatedType, options);
}
var init_instantiate20 = __esm({
  "node_modules/typebox/build/type/engine/partial/instantiate.mjs"() {
    init_memory2();
    init_partial();
    init_from_type7();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}
function Pick(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options);
}
var init_pick = __esm({
  "node_modules/typebox/build/type/action/pick.mjs"() {
    init_guard2();
    init_deferred();
    init_keys_to_indexer();
    init_instantiate21();
  }
});

// node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}
var init_from_type8 = __esm({
  "node_modules/typebox/build/type/engine/pick/from_type.mjs"() {
    init_memory2();
    init_guard2();
    init_object();
    init_to_indexable_keys();
    init_to_indexable();
  }
});

// node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}
var init_instantiate21 = __esm({
  "node_modules/typebox/build/type/engine/pick/instantiate.mjs"() {
    init_memory2();
    init_pick();
    init_instantiate27();
    init_from_type8();
  }
});

// node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}
function ReadonlyObject(type, options = {}) {
  return ReadonlyObjectAction(type, options);
}
var ReadonlyType;
var init_readonly_object = __esm({
  "node_modules/typebox/build/type/action/readonly_object.mjs"() {
    init_deferred();
    init_instantiate22();
    ReadonlyType = ReadonlyObject;
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray5(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}
var init_from_array3 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_array.mjs"() {
    init_array();
    init_add_immutable();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}
var init_from_cyclic4 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs"() {
    init_memory2();
    init_cyclic();
    init_from_type9();
    init_target();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}
var init_from_dependent4 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs"() {
    init_from_type9();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}
var init_from_intersect4 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs"() {
    init_from_type9();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}
var init_from_object5 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_object.mjs"() {
    init_guard2();
    init_object();
    init_add_readonly();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}
var init_from_tuple4 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs"() {
    init_tuple();
    init_add_immutable();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}
var init_from_union5 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_union.mjs"() {
    init_union();
    init_from_type9();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray5(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject8(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}
var init_from_type9 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/from_type.mjs"() {
    init_array();
    init_cyclic();
    init_dependent();
    init_intersect();
    init_object();
    init_tuple();
    init_union();
    init_from_array3();
    init_from_cyclic4();
    init_from_dependent4();
    init_from_intersect4();
    init_from_object5();
    init_from_tuple4();
    init_from_union5();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReadonlyObjectAction(instantiatedType, options);
}
var init_instantiate22 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs"() {
    init_memory2();
    init_readonly_object();
    init_from_type9();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state["callstack"], [...state["visited"], ref]), context[ref]) : type;
}
var init_instantiate23 = __esm({
  "node_modules/typebox/build/type/engine/ref/instantiate.mjs"() {
    init_instantiate27();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}
var init_from_cyclic5 = __esm({
  "node_modules/typebox/build/type/engine/required/from_cyclic.mjs"() {
    init_memory2();
    init_cyclic();
    init_from_type10();
    init_target();
  }
});

// node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}
var init_from_dependent5 = __esm({
  "node_modules/typebox/build/type/engine/required/from_dependent.mjs"() {
    init_from_type10();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}
var init_from_intersect5 = __esm({
  "node_modules/typebox/build/type/engine/required/from_intersect.mjs"() {
    init_from_type10();
    init_evaluate2();
  }
});

// node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}
var init_from_union6 = __esm({
  "node_modules/typebox/build/type/engine/required/from_union.mjs"() {
    init_union();
    init_from_type10();
  }
});

// node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject9(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}
var init_from_object6 = __esm({
  "node_modules/typebox/build/type/engine/required/from_object.mjs"() {
    init_guard2();
    init_object();
    init_remove_optional();
  }
});

// node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject9(type.properties) : _Object_({});
}
var init_from_type10 = __esm({
  "node_modules/typebox/build/type/engine/required/from_type.mjs"() {
    init_cyclic();
    init_dependent();
    init_intersect();
    init_object();
    init_union();
    init_from_cyclic5();
    init_from_dependent5();
    init_from_intersect5();
    init_from_union6();
    init_from_object6();
  }
});

// node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}
function Required(type, options = {}) {
  return RequiredAction(type, options);
}
var init_required = __esm({
  "node_modules/typebox/build/type/action/required.mjs"() {
    init_deferred();
    init_instantiate24();
  }
});

// node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return RequiredAction(instaniatedType, options);
}
var init_instantiate24 = __esm({
  "node_modules/typebox/build/type/engine/required/instantiate.mjs"() {
    init_memory2();
    init_from_type10();
    init_required();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}
function ReturnType(type, options = {}) {
  return ReturnTypeAction(type, options);
}
var init_return_type2 = __esm({
  "node_modules/typebox/build/type/action/return_type.mjs"() {
    init_deferred();
    init_instantiate25();
  }
});

// node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReturnTypeAction(instantiatedType, options);
}
var init_instantiate25 = __esm({
  "node_modules/typebox/build/type/engine/return_type/instantiate.mjs"() {
    init_memory2();
    init_function();
    init_never();
    init_return_type2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With2(type, options) {
  return WithAction(type, options);
}
var init_with = __esm({
  "node_modules/typebox/build/type/action/with.mjs"() {
    init_deferred();
    init_instantiate26();
  }
});

// node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return WithAction(instaniatedType, options);
}
var init_instantiate26 = __esm({
  "node_modules/typebox/build/type/engine/with/instantiate.mjs"() {
    init_memory2();
    init_instantiate27();
    init_with();
  }
});

// node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}
var init_spread = __esm({
  "node_modules/typebox/build/type/engine/rest/spread.mjs"() {
    init_infer();
    init_never();
    init_rest();
    init_ref();
    init_tuple();
  }
});

// node_modules/typebox/build/type/engine/rest/index.mjs
var init_rest3 = __esm({
  "node_modules/typebox/build/type/engine/rest/index.mjs"() {
    init_spread();
  }
});

// node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited2) {
  return { callstack, visited: visited2 };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state, properties[key]) };
  }, {});
}
function InstantiateElements(context, state, types) {
  const elements = InstantiateTypes(context, state, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state, types) {
  return types.map((type) => InstantiateType(context, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context, state, type) {
  const instantiatedType = IsRef(type) ? RefInstantiate(context, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state, type.if), InstantiateType(context, state, type.then), InstantiateType(context, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state, type.action, type.parameters, type.options) : InstantiateImmediate(context, state, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}
var init_instantiate27 = __esm({
  "node_modules/typebox/build/type/engine/instantiate.mjs"() {
    init_guard2();
    init_instantiate_add3();
    init_instantiate_add();
    init_instantiate_add2();
    init_array();
    init_constructor();
    init_deferred();
    init_function();
    init_call();
    init_dependent();
    init_intersect();
    init_object();
    init_record();
    init_tuple();
    init_union();
    init_ref();
    init_rest();
    init_instantiate_add3();
    init_instantiate_remove3();
    init_instantiate_add();
    init_instantiate_remove();
    init_instantiate_add2();
    init_instantiate_remove2();
    init_optional();
    init_immutable();
    init_readonly();
    init_instantiate6();
    init_instantiate7();
    init_conditional2();
    init_instantiate9();
    init_instantiate5();
    init_instantiate10();
    init_instantiate11();
    init_instantiate12();
    init_instantiate13();
    init_instantiate3();
    init_instantiate14();
    init_instantiate7();
    init_instantiate15();
    init_instantiate16();
    init_instantiate17();
    init_instantiate18();
    init_instantiate19();
    init_instantiate20();
    init_instantiate21();
    init_instantiate22();
    init_instantiate();
    init_instantiate23();
    init_instantiate24();
    init_instantiate25();
    init_instantiate2();
    init_instantiate7();
    init_instantiate7();
    init_instantiate26();
    init_rest3();
  }
});

// node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddImmutableAction(instantiatedType, options);
}
var init_instantiate_add3 = __esm({
  "node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs"() {
    init_memory2();
    init_instantiate27();
  }
});

// node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options = {}) {
  return Deferred("AddImmutable", [type], options);
}
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}
var init_add_immutable = __esm({
  "node_modules/typebox/build/type/action/_add_immutable.mjs"() {
    init_deferred();
    init_instantiate_add3();
  }
});

// node_modules/typebox/build/type/action/_remove_immutable.mjs
var init_remove_immutable = __esm({
  "node_modules/typebox/build/type/action/_remove_immutable.mjs"() {
    init_deferred();
    init_instantiate_remove3();
  }
});

// node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options = {}) {
  return Deferred("Evaluate", [type], options);
}
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}
var init_evaluate4 = __esm({
  "node_modules/typebox/build/type/action/evaluate.mjs"() {
    init_deferred();
    init_instantiate5();
  }
});

// node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options = {}) {
  return Deferred("Module", [declarations], options);
}
function Module2(declarations, options = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options);
}
var init_module = __esm({
  "node_modules/typebox/build/type/action/module.mjs"() {
    init_deferred();
    init_instantiate27();
    init_instantiate16();
  }
});

// node_modules/typebox/build/type/action/index.mjs
var init_action = __esm({
  "node_modules/typebox/build/type/action/index.mjs"() {
    init_add_immutable();
    init_add_readonly();
    init_add_optional();
    init_remove_immutable();
    init_remove_readonly();
    init_remove_optional();
    init_capitalize();
    init_conditional();
    init_constructor_parameters();
    init_evaluate4();
    init_exclude();
    init_extract();
    init_indexed();
    init_instance_type();
    init_interface();
    init_keyof();
    init_lowercase();
    init_mapped();
    init_module();
    init_non_nullable();
    init_omit();
    init_parameters2();
    init_partial();
    init_pick();
    init_readonly_object();
    init_required();
    init_return_type2();
    init_uncapitalize();
    init_uppercase();
    init_with();
  }
});

// node_modules/typebox/build/type/engine/constructor_parameters/index.mjs
var init_constructor_parameters2 = __esm({
  "node_modules/typebox/build/type/engine/constructor_parameters/index.mjs"() {
    init_instantiate9();
  }
});

// node_modules/typebox/build/type/engine/enum/index.mjs
var init_enum3 = __esm({
  "node_modules/typebox/build/type/engine/enum/index.mjs"() {
    init_typescript_enum_to_enum_values();
  }
});

// node_modules/typebox/build/type/engine/exclude/index.mjs
var init_exclude2 = __esm({
  "node_modules/typebox/build/type/engine/exclude/index.mjs"() {
    init_instantiate10();
  }
});

// node_modules/typebox/build/type/engine/extract/index.mjs
var init_extract2 = __esm({
  "node_modules/typebox/build/type/engine/extract/index.mjs"() {
    init_instantiate11();
  }
});

// node_modules/typebox/build/type/engine/helpers/union.mjs
var init_union3 = __esm({
  "node_modules/typebox/build/type/engine/helpers/union.mjs"() {
  }
});

// node_modules/typebox/build/type/engine/helpers/index.mjs
var init_helpers = __esm({
  "node_modules/typebox/build/type/engine/helpers/index.mjs"() {
    init_keys_to_indexer();
    init_keys();
    init_union3();
  }
});

// node_modules/typebox/build/type/engine/indexed/index.mjs
var init_indexed2 = __esm({
  "node_modules/typebox/build/type/engine/indexed/index.mjs"() {
    init_instantiate12();
  }
});

// node_modules/typebox/build/type/engine/instance_type/index.mjs
var init_instance_type2 = __esm({
  "node_modules/typebox/build/type/engine/instance_type/index.mjs"() {
    init_instantiate13();
  }
});

// node_modules/typebox/build/type/engine/interface/index.mjs
var init_interface2 = __esm({
  "node_modules/typebox/build/type/engine/interface/index.mjs"() {
    init_instantiate3();
  }
});

// node_modules/typebox/build/type/engine/intrinsics/index.mjs
var init_intrinsics = __esm({
  "node_modules/typebox/build/type/engine/intrinsics/index.mjs"() {
    init_instantiate7();
  }
});

// node_modules/typebox/build/type/engine/keyof/index.mjs
var init_keyof2 = __esm({
  "node_modules/typebox/build/type/engine/keyof/index.mjs"() {
    init_instantiate14();
  }
});

// node_modules/typebox/build/type/engine/mapped/index.mjs
var init_mapped2 = __esm({
  "node_modules/typebox/build/type/engine/mapped/index.mjs"() {
    init_instantiate15();
  }
});

// node_modules/typebox/build/type/engine/module/index.mjs
var init_module2 = __esm({
  "node_modules/typebox/build/type/engine/module/index.mjs"() {
    init_instantiate16();
  }
});

// node_modules/typebox/build/type/engine/non_nullable/index.mjs
var init_non_nullable2 = __esm({
  "node_modules/typebox/build/type/engine/non_nullable/index.mjs"() {
    init_instantiate17();
  }
});

// node_modules/typebox/build/type/engine/omit/index.mjs
var init_omit2 = __esm({
  "node_modules/typebox/build/type/engine/omit/index.mjs"() {
    init_instantiate18();
  }
});

// node_modules/typebox/build/type/engine/parameters/index.mjs
var init_parameters3 = __esm({
  "node_modules/typebox/build/type/engine/parameters/index.mjs"() {
    init_instantiate19();
  }
});

// node_modules/typebox/build/type/engine/patterns/index.mjs
var init_patterns = __esm({
  "node_modules/typebox/build/type/engine/patterns/index.mjs"() {
    init_pattern();
    init_template();
  }
});

// node_modules/typebox/build/type/engine/partial/index.mjs
var init_partial2 = __esm({
  "node_modules/typebox/build/type/engine/partial/index.mjs"() {
    init_instantiate20();
  }
});

// node_modules/typebox/build/type/engine/pick/index.mjs
var init_pick2 = __esm({
  "node_modules/typebox/build/type/engine/pick/index.mjs"() {
    init_instantiate21();
  }
});

// node_modules/typebox/build/type/engine/priority/priority.mjs
function Comparer(left, right) {
  const compareResult = Compare(left, right);
  const result = guard_exports.IsEqual(compareResult, "right-inside") ? 1 : guard_exports.IsEqual(compareResult, "disjoint") ? 1 : 0;
  return result;
}
function Insert(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => guard_exports.IsEqual(Comparer(type, left), 1) ? Insert(type, right, [...result, left]) : [...result, type, ...types], () => [...result, type]);
}
function Sort(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Sort(right, Insert(left, result)), () => result);
}
function Priority(types) {
  const result = Sort(types);
  return result;
}
var init_priority = __esm({
  "node_modules/typebox/build/type/engine/priority/priority.mjs"() {
    init_guard2();
    init_compare();
  }
});

// node_modules/typebox/build/type/engine/priority/index.mjs
var init_priority2 = __esm({
  "node_modules/typebox/build/type/engine/priority/index.mjs"() {
    init_priority();
  }
});

// node_modules/typebox/build/type/engine/readonly_object/index.mjs
var init_readonly_object2 = __esm({
  "node_modules/typebox/build/type/engine/readonly_object/index.mjs"() {
    init_instantiate22();
  }
});

// node_modules/typebox/build/type/engine/record/index.mjs
var init_record3 = __esm({
  "node_modules/typebox/build/type/engine/record/index.mjs"() {
    init_instantiate();
  }
});

// node_modules/typebox/build/type/engine/ref/index.mjs
var init_ref2 = __esm({
  "node_modules/typebox/build/type/engine/ref/index.mjs"() {
    init_instantiate23();
  }
});

// node_modules/typebox/build/type/engine/required/index.mjs
var init_required2 = __esm({
  "node_modules/typebox/build/type/engine/required/index.mjs"() {
    init_instantiate24();
  }
});

// node_modules/typebox/build/type/engine/return_type/index.mjs
var init_return_type3 = __esm({
  "node_modules/typebox/build/type/engine/return_type/index.mjs"() {
    init_instantiate25();
  }
});

// node_modules/typebox/build/type/engine/template_literal/static.mjs
var init_static2 = __esm({
  "node_modules/typebox/build/type/engine/template_literal/static.mjs"() {
  }
});

// node_modules/typebox/build/type/engine/template_literal/is_pattern.mjs
var init_is_pattern = __esm({
  "node_modules/typebox/build/type/engine/template_literal/is_pattern.mjs"() {
    init_guard2();
    init_pattern();
  }
});

// node_modules/typebox/build/type/engine/template_literal/index.mjs
var init_template_literal3 = __esm({
  "node_modules/typebox/build/type/engine/template_literal/index.mjs"() {
    init_create2();
    init_decode();
    init_encode();
    init_static2();
    init_is_finite();
    init_is_pattern();
  }
});

// node_modules/typebox/build/type/engine/with/index.mjs
var init_with2 = __esm({
  "node_modules/typebox/build/type/engine/with/index.mjs"() {
    init_instantiate26();
  }
});

// node_modules/typebox/build/type/engine/index.mjs
var init_engine = __esm({
  "node_modules/typebox/build/type/engine/index.mjs"() {
    init_instantiate27();
    init_conditional2();
    init_constructor_parameters2();
    init_cyclic2();
    init_enum3();
    init_evaluate3();
    init_exclude2();
    init_extract2();
    init_helpers();
    init_indexed2();
    init_instance_type2();
    init_interface2();
    init_intrinsics();
    init_keyof2();
    init_mapped2();
    init_module2();
    init_non_nullable2();
    init_object3();
    init_omit2();
    init_parameters3();
    init_patterns();
    init_partial2();
    init_pick2();
    init_priority2();
    init_readonly_object2();
    init_record3();
    init_ref2();
    init_required2();
    init_return_type3();
    init_template_literal3();
    init_with2();
  }
});

// node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options] = arguments_exports.Match(args, {
    2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
    3: (context2, script, options2) => [context2, script, options2],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options);
}
var init_script = __esm({
  "node_modules/typebox/build/type/script/script.mjs"() {
    init_arguments2();
    init_memory2();
    init_guard2();
    init_types();
    init_instantiate27();
    init_instantiate27();
    init_parser();
  }
});

// node_modules/typebox/build/type/script/index.mjs
var init_script2 = __esm({
  "node_modules/typebox/build/type/script/index.mjs"() {
    init_script();
  }
});

// node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef,
  IsRefine: () => IsRefine,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});
var init_typebox = __esm({
  "node_modules/typebox/build/typebox.mjs"() {
    init_instantiate27();
    init_extends3();
    init_script2();
    init_capitalize();
    init_conditional();
    init_constructor_parameters();
    init_evaluate4();
    init_exclude();
    init_extract();
    init_action();
    init_instance_type();
    init_interface();
    init_keyof();
    init_lowercase();
    init_mapped();
    init_module();
    init_non_nullable();
    init_omit();
    init_parameters2();
    init_partial();
    init_pick();
    init_readonly_object();
    init_required();
    init_return_type2();
    init_uncapitalize();
    init_uppercase();
    init_with();
    init_codec();
    init_immutable();
    init_optional();
    init_readonly();
    init_refine();
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_call();
    init_constructor();
    init_cyclic();
    init_enum();
    init_function();
    init_generic();
    init_identifier();
    init_dependent();
    init_infer();
    init_integer();
    init_intersect();
    init_literal();
    init_never();
    init_null();
    init_number();
    init_object();
    init_parameter();
    init_record();
    init_ref();
    init_rest();
    init_schema();
    init_string2();
    init_symbol();
    init_template_literal();
    init_this();
    init_tuple();
    init_undefined();
    init_union();
    init_unknown();
    init_unsafe();
    init_void();
  }
});

// node_modules/typebox/build/index.mjs
var init_build = __esm({
  "node_modules/typebox/build/index.mjs"() {
    init_action();
    init_engine();
    init_extends3();
    init_script2();
    init_types();
    init_typebox();
    init_typebox();
  }
});

// node_modules/typebox/build/schema/types/_refine.mjs
function IsRefine2(value) {
  return guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => guard_exports.IsObject(value2) && guard_exports.HasPropertyKey(value2, "check") && guard_exports.HasPropertyKey(value2, "error") && guard_exports.IsFunction(value2.check) && guard_exports.IsFunction(value2.error));
}
var init_refine2 = __esm({
  "node_modules/typebox/build/schema/types/_refine.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/schema.mjs
function IsSchemaObject(value) {
  return guard_exports.IsObject(value) && !guard_exports.IsArray(value);
}
function IsSchemaBoolean(value) {
  return guard_exports.IsBoolean(value);
}
function IsSchema2(value) {
  return IsSchemaObject(value) || IsSchemaBoolean(value);
}
var init_schema2 = __esm({
  "node_modules/typebox/build/schema/types/schema.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/additionalItems.mjs
function IsAdditionalItems(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalItems") && IsSchema2(schema.additionalItems);
}
var init_additionalItems = __esm({
  "node_modules/typebox/build/schema/types/additionalItems.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/additionalProperties.mjs
function IsAdditionalProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalProperties") && IsSchema2(schema.additionalProperties);
}
var init_additionalProperties = __esm({
  "node_modules/typebox/build/schema/types/additionalProperties.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/allOf.mjs
function IsAllOf(schema) {
  return guard_exports.HasPropertyKey(schema, "allOf") && guard_exports.IsArray(schema.allOf) && schema.allOf.every((value) => IsSchema2(value));
}
var init_allOf = __esm({
  "node_modules/typebox/build/schema/types/allOf.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/anchor.mjs
function IsAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$anchor") && guard_exports.IsString(schema.$anchor);
}
var init_anchor = __esm({
  "node_modules/typebox/build/schema/types/anchor.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/anyOf.mjs
function IsAnyOf(schema) {
  return guard_exports.HasPropertyKey(schema, "anyOf") && guard_exports.IsArray(schema.anyOf) && schema.anyOf.every((value) => IsSchema2(value));
}
var init_anyOf = __esm({
  "node_modules/typebox/build/schema/types/anyOf.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/const.mjs
function IsConst(value) {
  return guard_exports.HasPropertyKey(value, "const");
}
var init_const2 = __esm({
  "node_modules/typebox/build/schema/types/const.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/contains.mjs
function IsContains(schema) {
  return guard_exports.HasPropertyKey(schema, "contains") && IsSchema2(schema.contains);
}
var init_contains = __esm({
  "node_modules/typebox/build/schema/types/contains.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/contentEncoding.mjs
var init_contentEncoding = __esm({
  "node_modules/typebox/build/schema/types/contentEncoding.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/contentMediaType.mjs
var init_contentMediaType = __esm({
  "node_modules/typebox/build/schema/types/contentMediaType.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/default.mjs
function IsDefault(schema) {
  return guard_exports.HasPropertyKey(schema, "default");
}
var init_default = __esm({
  "node_modules/typebox/build/schema/types/default.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/defs.mjs
var init_defs = __esm({
  "node_modules/typebox/build/schema/types/defs.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/dependencies.mjs
function IsDependencies(schema) {
  return guard_exports.HasPropertyKey(schema, "dependencies") && guard_exports.IsObject(schema.dependencies) && Object.values(schema.dependencies).every((value) => IsSchema2(value) || guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}
var init_dependencies2 = __esm({
  "node_modules/typebox/build/schema/types/dependencies.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/dependentRequired.mjs
function IsDependentRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentRequired") && guard_exports.IsObject(schema.dependentRequired) && Object.values(schema.dependentRequired).every((value) => guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}
var init_dependentRequired = __esm({
  "node_modules/typebox/build/schema/types/dependentRequired.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/dependentSchemas.mjs
function IsDependentSchemas(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentSchemas") && guard_exports.IsObject(schema.dependentSchemas) && Object.values(schema.dependentSchemas).every((value) => IsSchema2(value));
}
var init_dependentSchemas = __esm({
  "node_modules/typebox/build/schema/types/dependentSchemas.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/dynamicAnchor.mjs
function IsDynamicAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicAnchor") && guard_exports.IsString(schema.$dynamicAnchor);
}
var init_dynamicAnchor = __esm({
  "node_modules/typebox/build/schema/types/dynamicAnchor.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/dynamicRef.mjs
function IsDynamicRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicRef") && guard_exports.IsString(schema.$dynamicRef);
}
var init_dynamicRef = __esm({
  "node_modules/typebox/build/schema/types/dynamicRef.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/else.mjs
function IsElse(schema) {
  return guard_exports.HasPropertyKey(schema, "else") && IsSchema2(schema.else);
}
var init_else = __esm({
  "node_modules/typebox/build/schema/types/else.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/enum.mjs
function IsEnum2(schema) {
  return guard_exports.HasPropertyKey(schema, "enum") && guard_exports.IsArray(schema.enum);
}
var init_enum4 = __esm({
  "node_modules/typebox/build/schema/types/enum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/exclusiveMaximum.mjs
function IsExclusiveMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMaximum") && (guard_exports.IsNumber(schema.exclusiveMaximum) || guard_exports.IsBigInt(schema.exclusiveMaximum));
}
var init_exclusiveMaximum = __esm({
  "node_modules/typebox/build/schema/types/exclusiveMaximum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/exclusiveMinimum.mjs
function IsExclusiveMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMinimum") && (guard_exports.IsNumber(schema.exclusiveMinimum) || guard_exports.IsBigInt(schema.exclusiveMinimum));
}
var init_exclusiveMinimum = __esm({
  "node_modules/typebox/build/schema/types/exclusiveMinimum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/format.mjs
function IsFormat(schema) {
  return guard_exports.HasPropertyKey(schema, "format") && guard_exports.IsString(schema.format);
}
var init_format = __esm({
  "node_modules/typebox/build/schema/types/format.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/id.mjs
function IsId(schema) {
  return guard_exports.HasPropertyKey(schema, "$id") && guard_exports.IsString(schema.$id);
}
var init_id = __esm({
  "node_modules/typebox/build/schema/types/id.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/if.mjs
function IsIf(schema) {
  return guard_exports.HasPropertyKey(schema, "if") && IsSchema2(schema.if);
}
var init_if = __esm({
  "node_modules/typebox/build/schema/types/if.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/items.mjs
function IsItems(schema) {
  return guard_exports.HasPropertyKey(schema, "items") && (IsSchema2(schema.items) || guard_exports.IsArray(schema.items) && schema.items.every((value) => {
    return IsSchema2(value);
  }));
}
function IsItemsSized(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}
var init_items = __esm({
  "node_modules/typebox/build/schema/types/items.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/maximum.mjs
function IsMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "maximum") && (guard_exports.IsNumber(schema.maximum) || guard_exports.IsBigInt(schema.maximum));
}
var init_maximum = __esm({
  "node_modules/typebox/build/schema/types/maximum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/maxContains.mjs
function IsMaxContains(schema) {
  return guard_exports.HasPropertyKey(schema, "maxContains") && guard_exports.IsNumber(schema.maxContains);
}
var init_maxContains = __esm({
  "node_modules/typebox/build/schema/types/maxContains.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/maxItems.mjs
function IsMaxItems(schema) {
  return guard_exports.HasPropertyKey(schema, "maxItems") && guard_exports.IsNumber(schema.maxItems);
}
var init_maxItems = __esm({
  "node_modules/typebox/build/schema/types/maxItems.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/maxLength.mjs
function IsMaxLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "maxLength") && guard_exports.IsNumber(schema.maxLength);
}
var init_maxLength = __esm({
  "node_modules/typebox/build/schema/types/maxLength.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/maxProperties.mjs
function IsMaxProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "maxProperties") && guard_exports.IsNumber(schema.maxProperties);
}
var init_maxProperties = __esm({
  "node_modules/typebox/build/schema/types/maxProperties.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/minimum.mjs
function IsMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "minimum") && (guard_exports.IsNumber(schema.minimum) || guard_exports.IsBigInt(schema.minimum));
}
var init_minimum = __esm({
  "node_modules/typebox/build/schema/types/minimum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/minContains.mjs
function IsMinContains(schema) {
  return guard_exports.HasPropertyKey(schema, "minContains") && guard_exports.IsNumber(schema.minContains);
}
var init_minContains = __esm({
  "node_modules/typebox/build/schema/types/minContains.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/minItems.mjs
function IsMinItems(schema) {
  return guard_exports.HasPropertyKey(schema, "minItems") && guard_exports.IsNumber(schema.minItems);
}
var init_minItems = __esm({
  "node_modules/typebox/build/schema/types/minItems.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/minLength.mjs
function IsMinLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "minLength") && guard_exports.IsNumber(schema.minLength);
}
var init_minLength = __esm({
  "node_modules/typebox/build/schema/types/minLength.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/minProperties.mjs
function IsMinProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "minProperties") && guard_exports.IsNumber(schema.minProperties);
}
var init_minProperties = __esm({
  "node_modules/typebox/build/schema/types/minProperties.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/multipleOf.mjs
function IsMultipleOf2(schema) {
  return guard_exports.HasPropertyKey(schema, "multipleOf") && (guard_exports.IsNumber(schema.multipleOf) || guard_exports.IsBigInt(schema.multipleOf));
}
var init_multipleOf = __esm({
  "node_modules/typebox/build/schema/types/multipleOf.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/not.mjs
function IsNot(schema) {
  return guard_exports.HasPropertyKey(schema, "not") && IsSchema2(schema.not);
}
var init_not = __esm({
  "node_modules/typebox/build/schema/types/not.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/oneOf.mjs
function IsOneOf(schema) {
  return guard_exports.HasPropertyKey(schema, "oneOf") && guard_exports.IsArray(schema.oneOf) && schema.oneOf.every((value) => IsSchema2(value));
}
var init_oneOf = __esm({
  "node_modules/typebox/build/schema/types/oneOf.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/pattern.mjs
function IsPattern(schema) {
  return guard_exports.HasPropertyKey(schema, "pattern") && (guard_exports.IsString(schema.pattern) || schema.pattern instanceof RegExp);
}
var init_pattern2 = __esm({
  "node_modules/typebox/build/schema/types/pattern.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/patternProperties.mjs
function IsPatternProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "patternProperties") && guard_exports.IsObject(schema.patternProperties) && Object.values(schema.patternProperties).every((value) => IsSchema2(value));
}
var init_patternProperties = __esm({
  "node_modules/typebox/build/schema/types/patternProperties.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/prefixItems.mjs
function IsPrefixItems(schema) {
  return guard_exports.HasPropertyKey(schema, "prefixItems") && guard_exports.IsArray(schema.prefixItems) && schema.prefixItems.every((schema2) => IsSchema2(schema2));
}
var init_prefixItems = __esm({
  "node_modules/typebox/build/schema/types/prefixItems.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/properties.mjs
function IsProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "properties") && guard_exports.IsObject(schema.properties) && Object.values(schema.properties).every((value) => IsSchema2(value));
}
var init_properties2 = __esm({
  "node_modules/typebox/build/schema/types/properties.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/propertyNames.mjs
function IsPropertyNames(schema) {
  return guard_exports.HasPropertyKey(schema, "propertyNames") && (guard_exports.IsObject(schema.propertyNames) || IsSchema2(schema.propertyNames));
}
var init_propertyNames = __esm({
  "node_modules/typebox/build/schema/types/propertyNames.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/recursiveAnchor.mjs
function IsRecursiveAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveAnchor") && guard_exports.IsBoolean(schema.$recursiveAnchor);
}
function IsRecursiveAnchorTrue(schema) {
  return IsRecursiveAnchor(schema) && guard_exports.IsEqual(schema.$recursiveAnchor, true);
}
var init_recursiveAnchor = __esm({
  "node_modules/typebox/build/schema/types/recursiveAnchor.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/recursiveRef.mjs
function IsRecursiveRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveRef") && guard_exports.IsString(schema.$recursiveRef);
}
var init_recursiveRef = __esm({
  "node_modules/typebox/build/schema/types/recursiveRef.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/ref.mjs
function IsRef2(schema) {
  return guard_exports.HasPropertyKey(schema, "$ref") && guard_exports.IsString(schema.$ref);
}
var init_ref3 = __esm({
  "node_modules/typebox/build/schema/types/ref.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/required.mjs
function IsRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "required") && guard_exports.IsArray(schema.required) && schema.required.every((value) => guard_exports.IsString(value));
}
var init_required3 = __esm({
  "node_modules/typebox/build/schema/types/required.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/then.mjs
function IsThen(schema) {
  return guard_exports.HasPropertyKey(schema, "then") && IsSchema2(schema.then);
}
var init_then = __esm({
  "node_modules/typebox/build/schema/types/then.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/type.mjs
function IsType(schema) {
  return guard_exports.HasPropertyKey(schema, "type") && (guard_exports.IsString(schema.type) || guard_exports.IsArray(schema.type) && schema.type.every((value) => guard_exports.IsString(value)));
}
var init_type = __esm({
  "node_modules/typebox/build/schema/types/type.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/uniqueItems.mjs
function IsUniqueItems(schema) {
  return guard_exports.HasPropertyKey(schema, "uniqueItems") && guard_exports.IsBoolean(schema.uniqueItems);
}
var init_uniqueItems = __esm({
  "node_modules/typebox/build/schema/types/uniqueItems.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/types/unevaluatedItems.mjs
function IsUnevaluatedItems(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedItems") && IsSchema2(schema.unevaluatedItems);
}
var init_unevaluatedItems = __esm({
  "node_modules/typebox/build/schema/types/unevaluatedItems.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/unevaluatedProperties.mjs
function IsUnevaluatedProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedProperties") && IsSchema2(schema.unevaluatedProperties);
}
var init_unevaluatedProperties = __esm({
  "node_modules/typebox/build/schema/types/unevaluatedProperties.mjs"() {
    init_guard2();
    init_schema2();
  }
});

// node_modules/typebox/build/schema/types/index.mjs
var init_types2 = __esm({
  "node_modules/typebox/build/schema/types/index.mjs"() {
    init_refine2();
    init_additionalItems();
    init_additionalProperties();
    init_allOf();
    init_anchor();
    init_anyOf();
    init_const2();
    init_contains();
    init_contentEncoding();
    init_contentMediaType();
    init_default();
    init_defs();
    init_dependencies2();
    init_dependentRequired();
    init_dependentSchemas();
    init_dynamicAnchor();
    init_dynamicRef();
    init_else();
    init_enum4();
    init_exclusiveMaximum();
    init_exclusiveMinimum();
    init_format();
    init_id();
    init_if();
    init_items();
    init_maximum();
    init_maxContains();
    init_maxItems();
    init_maxLength();
    init_maxProperties();
    init_minimum();
    init_minContains();
    init_minItems();
    init_minLength();
    init_minProperties();
    init_multipleOf();
    init_not();
    init_oneOf();
    init_pattern2();
    init_patternProperties();
    init_prefixItems();
    init_properties2();
    init_propertyNames();
    init_recursiveAnchor();
    init_recursiveRef();
    init_ref3();
    init_required3();
    init_schema2();
    init_then();
    init_type();
    init_uniqueItems();
    init_unevaluatedItems();
    init_unevaluatedProperties();
  }
});

// node_modules/typebox/build/schema/engine/_context.mjs
var CheckContext, ErrorContext, AccumulatedErrorContext;
var init_context = __esm({
  "node_modules/typebox/build/schema/engine/_context.mjs"() {
    init_types2();
    init_guard2();
    CheckContext = class {
      constructor() {
        const indices = /* @__PURE__ */ new Set();
        const keys = /* @__PURE__ */ new Set();
        this.stack = [{ indices, keys }];
      }
      // ----------------------------------------------------------------
      // Stack
      // ----------------------------------------------------------------
      Push() {
        const indices = /* @__PURE__ */ new Set();
        const keys = /* @__PURE__ */ new Set();
        this.stack.push({ indices, keys });
        return true;
      }
      Pop() {
        this.stack.pop();
        return true;
      }
      // ----------------------------------------------------------------
      // Top
      // ----------------------------------------------------------------
      AddIndex(index) {
        this.GetIndices().add(index);
        return true;
      }
      AddKey(key) {
        this.GetKeys().add(key);
        return true;
      }
      GetIndices() {
        const top = this.stack[this.stack.length - 1];
        return top.indices;
      }
      GetKeys() {
        const top = this.stack[this.stack.length - 1];
        return top.keys;
      }
      Merge(results) {
        for (const context of results) {
          context.GetIndices().forEach((value) => this.GetIndices().add(value));
          context.GetKeys().forEach((value) => this.GetKeys().add(value));
        }
        return true;
      }
    };
    ErrorContext = class extends CheckContext {
      constructor(callback) {
        super();
        this.callback = callback;
      }
      AddError(error) {
        this.callback(error);
        return false;
      }
    };
    AccumulatedErrorContext = class extends ErrorContext {
      constructor() {
        super((error) => this.errors.push(error));
        this.errors = [];
      }
      AddError(error) {
        this.errors.push(error);
        return false;
      }
      GetErrors() {
        return this.errors;
      }
    };
  }
});

// node_modules/typebox/build/schema/engine/_externals.mjs
var init_externals = __esm({
  "node_modules/typebox/build/schema/engine/_externals.mjs"() {
  }
});

// node_modules/typebox/build/schema/engine/_refine.mjs
function CheckRefine(_stack, _context, schema, value) {
  return guard_exports.Every(schema["~refine"], 0, (refinement, _) => refinement.check(value));
}
function ErrorRefine(_stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema["~refine"], 0, (refinement, index) => {
    return refinement.check(value) || context.AddError({
      keyword: "~refine",
      schemaPath,
      instancePath,
      params: { index, message: refinement.error(value) }
    });
  });
}
var init_refine3 = __esm({
  "node_modules/typebox/build/schema/engine/_refine.mjs"() {
    init_externals();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/_unique.mjs
var init_unique = __esm({
  "node_modules/typebox/build/schema/engine/_unique.mjs"() {
  }
});

// node_modules/typebox/build/schema/engine/additionalItems.mjs
function IsValid(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}
function CheckAdditionalItems(stack, context, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = value.every((item, index) => {
    return guard_exports.IsLessThan(index, schema.items.length) || CheckSchemaPushStack(stack, context, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}
function ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = value.every((item, index) => {
    const nextSchemaPath = `${schemaPath}/additionalItems`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessThan(index, schema.items.length) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}
var init_additionalItems2 = __esm({
  "node_modules/typebox/build/schema/engine/additionalItems.mjs"() {
    init_types2();
    init_unique();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/additionalProperties.mjs
function GetPropertyKeyAsPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}$`;
}
function GetPropertiesPattern(schema) {
  const patterns = [];
  if (IsPatternProperties(schema))
    patterns.push(...guard_exports.Keys(schema.patternProperties));
  if (IsProperties(schema))
    patterns.push(...guard_exports.Keys(schema.properties).map(GetPropertyKeyAsPattern));
  return guard_exports.IsEqual(patterns.length, 0) ? "(?!)" : `(${patterns.join("|")})`;
}
function CheckAdditionalProperties(stack, context, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const isAdditionalProperties = guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => {
    return regexp.test(key) || CheckSchemaPushStack(stack, context, schema.additionalProperties, value[key]) && context.AddKey(key);
  });
  return isAdditionalProperties;
}
function ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const additionalProperties = [];
  const isAdditionalProperties = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextSchemaPath = `${schemaPath}/additionalProperties`;
    const nextInstancePath = `${instancePath}/${key}`;
    const nextContext = new AccumulatedErrorContext();
    const isAdditionalProperty = regexp.test(key) || ErrorSchemaPushStack(stack, nextContext, nextSchemaPath, nextInstancePath, schema.additionalProperties, value[key]) && context.AddKey(key);
    if (!isAdditionalProperty)
      additionalProperties.push(key);
    return isAdditionalProperty;
  });
  return isAdditionalProperties || context.AddError({
    keyword: "additionalProperties",
    schemaPath,
    instancePath,
    params: { additionalProperties }
  });
}
var init_additionalProperties2 = __esm({
  "node_modules/typebox/build/schema/engine/additionalProperties.mjs"() {
    init_types2();
    init_externals();
    init_unique();
    init_context();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/_reducer.mjs
var init_reducer = __esm({
  "node_modules/typebox/build/schema/engine/_reducer.mjs"() {
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/allOf.mjs
function CheckAllOf(stack, context, schema, value) {
  const results = schema.allOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
}
function ErrorAllOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.allOf.reduce((result, schema2, index) => {
    const nextSchemaPath = `${schemaPath}/allOf/${index}`;
    const nextContext = new AccumulatedErrorContext();
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAllOf = guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
  if (!isAllOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAllOf;
}
var init_allOf2 = __esm({
  "node_modules/typebox/build/schema/engine/allOf.mjs"() {
    init_context();
    init_reducer();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/anyOf.mjs
function CheckAnyOf(stack, context, schema, value) {
  const results = schema.anyOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
}
function ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.anyOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/anyOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAnyOf = guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
  if (!isAnyOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAnyOf || context.AddError({
    keyword: "anyOf",
    schemaPath,
    instancePath,
    params: {}
  });
}
var init_anyOf2 = __esm({
  "node_modules/typebox/build/schema/engine/anyOf.mjs"() {
    init_context();
    init_reducer();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/boolean.mjs
function CheckSchemaBoolean(_stack, _context, schema, _value) {
  return schema;
}
function ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) {
  return CheckSchemaBoolean(stack, context, schema, value) || context.AddError({
    keyword: "boolean",
    schemaPath,
    instancePath,
    params: {}
  });
}
var init_boolean3 = __esm({
  "node_modules/typebox/build/schema/engine/boolean.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/const.mjs
function CheckConst(_stack, _context, schema, value) {
  return guard_exports.IsValueLike(schema.const) ? guard_exports.IsEqual(value, schema.const) : guard_exports.IsDeepEqual(value, schema.const);
}
function ErrorConst(stack, context, schemaPath, instancePath, schema, value) {
  return CheckConst(stack, context, schema, value) || context.AddError({
    keyword: "const",
    schemaPath,
    instancePath,
    params: { allowedValue: schema.const }
  });
}
var init_const3 = __esm({
  "node_modules/typebox/build/schema/engine/const.mjs"() {
    init_externals();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/contains.mjs
function IsValid2(schema) {
  return !(IsMinContains(schema) && guard_exports.IsEqual(schema.minContains, 0));
}
function CheckContains(stack, context, schema, value) {
  if (!IsValid2(schema))
    return true;
  return !guard_exports.IsEqual(value.length, 0) && value.some((item) => CheckSchema(stack, context, schema.contains, item));
}
function ErrorContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: 1 }
  });
}
var init_contains2 = __esm({
  "node_modules/typebox/build/schema/engine/contains.mjs"() {
    init_types2();
    init_unique();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/dependencies.mjs
function CheckDependencies(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((key2) => guard_exports.HasPropertyKey(value, key2)) : CheckSchema(stack, context, schema2, value));
  });
  return isLength || isEvery;
}
function ErrorDependencies(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependencies/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependencies",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: schema2 }
    })) : ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value));
  });
  return isLength || isEvery;
}
var init_dependencies3 = __esm({
  "node_modules/typebox/build/schema/engine/dependencies.mjs"() {
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/dependentRequired.mjs
function CheckDependentRequired(_stack, _context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || keys.every((key2) => guard_exports.HasPropertyKey(value, key2));
  });
  return isLength || isEvery;
}
function ErrorDependentRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEveryEntry = guard_exports.EveryAll(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || guard_exports.EveryAll(keys, 0, (dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependentRequired",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: keys }
    }));
  });
  return isLength || isEveryEntry;
}
var init_dependentRequired2 = __esm({
  "node_modules/typebox/build/schema/engine/dependentRequired.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/dependentSchemas.mjs
function CheckDependentSchemas(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || CheckSchema(stack, context, schema2, value);
  });
  return isLength || isEvery;
}
function ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependentSchemas/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value);
  });
  return isLength || isEvery;
}
var init_dependentSchemas2 = __esm({
  "node_modules/typebox/build/schema/engine/dependentSchemas.mjs"() {
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/dynamicRef.mjs
function CheckDynamicRef(stack, context, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema2(target) && CheckSchema(stack, context, target, value);
}
function ErrorDynamicRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}
var init_dynamicRef2 = __esm({
  "node_modules/typebox/build/schema/engine/dynamicRef.mjs"() {
    init_functions();
    init_types2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/enum.mjs
function CheckEnum(_stack, _context, schema, value) {
  return schema.enum.some((option) => guard_exports.IsValueLike(option) ? guard_exports.IsEqual(value, option) : guard_exports.IsDeepEqual(value, option));
}
function ErrorEnum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckEnum(stack, context, schema, value) || context.AddError({
    keyword: "enum",
    schemaPath,
    instancePath,
    params: { allowedValues: schema.enum }
  });
}
var init_enum5 = __esm({
  "node_modules/typebox/build/schema/engine/enum.mjs"() {
    init_externals();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/exclusiveMaximum.mjs
function CheckExclusiveMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessThan(value, schema.exclusiveMaximum);
}
function ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMaximum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMaximum",
    schemaPath,
    instancePath,
    params: { comparison: "<", limit: schema.exclusiveMaximum }
  });
}
var init_exclusiveMaximum2 = __esm({
  "node_modules/typebox/build/schema/engine/exclusiveMaximum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/exclusiveMinimum.mjs
function CheckExclusiveMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterThan(value, schema.exclusiveMinimum);
}
function ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMinimum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMinimum",
    schemaPath,
    instancePath,
    params: { comparison: ">", limit: schema.exclusiveMinimum }
  });
}
var init_exclusiveMinimum2 = __esm({
  "node_modules/typebox/build/schema/engine/exclusiveMinimum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/format/date.mjs
function IsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function IsDate2(value) {
  const matches = DATE.exec(value);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && IsLeapYear(year) ? 29 : DAYS[month]);
}
var DAYS, DATE;
var init_date = __esm({
  "node_modules/typebox/build/format/date.mjs"() {
    DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  }
});

// node_modules/typebox/build/format/time.mjs
function IsTime(value, strictTimeZone = true) {
  const matches = TIME.exec(value);
  if (!matches)
    return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  const tzSign = matches[4] === "-" ? -1 : 1;
  const tzH = +(matches[5] || 0);
  const tzM = +(matches[6] || 0);
  if (tzH > 23 || tzM > 59)
    return false;
  if (strictTimeZone && !matches[4] && value.toLowerCase().indexOf("z") === -1) {
    return false;
  }
  if (hr <= 23 && min <= 59 && sec < 60)
    return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}
var TIME;
var init_time = __esm({
  "node_modules/typebox/build/format/time.mjs"() {
    TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(?:Z|([+-])(\d\d):(\d\d))?$/i;
  }
});

// node_modules/typebox/build/format/date_time.mjs
function IsDateTime(value, strictTimeZone = true) {
  const dateTime = value.split(/T/i);
  return dateTime.length === 2 && IsDate2(dateTime[0]) && IsTime(dateTime[1], strictTimeZone);
}
var init_date_time = __esm({
  "node_modules/typebox/build/format/date_time.mjs"() {
    init_date();
    init_time();
  }
});

// node_modules/typebox/build/format/duration.mjs
function IsDuration(value) {
  return Duration.test(value);
}
var Duration;
var init_duration = __esm({
  "node_modules/typebox/build/format/duration.mjs"() {
    Duration = /^P((\d+Y(\d+M(\d+D)?)?|\d+M(\d+D)?|\d+D)(T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S))?|T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S)|\d+W)$/;
  }
});

// node_modules/typebox/build/format/email.mjs
function IsEmail(value) {
  return Email.test(value);
}
var Email;
var init_email = __esm({
  "node_modules/typebox/build/format/email.mjs"() {
    Email = /^(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  }
});

// node_modules/typebox/build/format/_puny.mjs
function Adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > (PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX >> 1) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta / (delta + PUNYCODE_SKEW));
}
function Decode2(value) {
  const output = [];
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  const delimIdx = value.lastIndexOf("-");
  if (delimIdx > 0) {
    for (let j = 0; j < delimIdx; j++) {
      const cp2 = value.charCodeAt(j);
      if (cp2 >= 128)
        throw new Error("Invalid punycode: non-basic before delimiter");
      output.push(cp2);
    }
  }
  let inIdx = delimIdx < 0 ? 0 : delimIdx + 1;
  while (inIdx < value.length) {
    const oldi = i;
    let w = 1;
    let k = PUNYCODE_BASE;
    while (true) {
      if (inIdx >= value.length)
        throw new Error("Invalid punycode: unexpected end of input");
      const ch = value.charCodeAt(inIdx++);
      let digit;
      if (ch >= 97 && ch <= 122)
        digit = ch - 97;
      else if (ch >= 48 && ch <= 57)
        digit = ch - 48 + 26;
      else if (ch >= 65 && ch <= 90)
        Unreachable();
      else
        throw new Error("Invalid punycode: bad digit character");
      i += digit * w;
      const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < t)
        break;
      w *= PUNYCODE_BASE - t;
      k += PUNYCODE_BASE;
    }
    const outLen = output.length + 1;
    bias = Adapt(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i, 0, n);
    i++;
  }
  return globalThis.String.fromCodePoint(...output);
}
var PUNYCODE_BASE, PUNYCODE_TMIN, PUNYCODE_TMAX, PUNYCODE_SKEW, PUNYCODE_DAMP, PUNYCODE_INITIAL_BIAS, PUNYCODE_INITIAL_N;
var init_puny = __esm({
  "node_modules/typebox/build/format/_puny.mjs"() {
    init_unreachable2();
    PUNYCODE_BASE = 36;
    PUNYCODE_TMIN = 1;
    PUNYCODE_TMAX = 26;
    PUNYCODE_SKEW = 38;
    PUNYCODE_DAMP = 700;
    PUNYCODE_INITIAL_BIAS = 72;
    PUNYCODE_INITIAL_N = 128;
  }
});

// node_modules/typebox/build/format/_idna.mjs
function IsNonspacingMark(cp2) {
  return /\p{Mn}/u.test(String.fromCodePoint(cp2));
}
function IsSpacingCombiningMark(cp2) {
  return /\p{Mc}/u.test(String.fromCodePoint(cp2));
}
function IsEnclosingMark(cp2) {
  return /\p{Me}/u.test(String.fromCodePoint(cp2));
}
function IsCombiningMark2(cp2) {
  return IsNonspacingMark(cp2) || IsSpacingCombiningMark(cp2) || IsEnclosingMark(cp2);
}
function IsGreek(cp2) {
  return /\p{Script=Greek}/u.test(String.fromCodePoint(cp2));
}
function IsHebrew(cp2) {
  return /\p{Script=Hebrew}/u.test(String.fromCodePoint(cp2));
}
function IsHiragana(cp2) {
  return /\p{Script=Hiragana}/u.test(String.fromCodePoint(cp2));
}
function IsKatakana(cp2) {
  return /\p{Script=Katakana}/u.test(String.fromCodePoint(cp2));
}
function IsHan(cp2) {
  return /\p{Script=Han}/u.test(String.fromCodePoint(cp2));
}
function IsArabicIndicDigit(cp2) {
  return cp2 >= 1632 && cp2 <= 1641;
}
function IsExtendedArabicIndicDigit(cp2) {
  return cp2 >= 1776 && cp2 <= 1785;
}
function IsVirama(cp2) {
  return VIRAMA_CPS.has(cp2);
}
function IsUnicodeLabel(value) {
  if (value.length === 0)
    return Unreachable();
  const cps = [...value].map((c) => c.codePointAt(0));
  const len = cps.length;
  if (cps[0] === 45 || cps[len - 1] === 45)
    return false;
  if (len >= 4 && cps[2] === 45 && cps[3] === 45)
    return false;
  if (IsCombiningMark2(cps[0]))
    return false;
  let hasJapanese = false;
  let hasArabicIndic = false;
  let hasExtendedArabicIndic = false;
  for (let i = 0; i < len; i++) {
    const cp2 = cps[i];
    if (RFC5892_DISALLOWED.has(cp2))
      return false;
    if (IsHiragana(cp2) || IsKatakana(cp2) || IsHan(cp2))
      hasJapanese = true;
    if (IsArabicIndicDigit(cp2))
      hasArabicIndic = true;
    if (IsExtendedArabicIndicDigit(cp2))
      hasExtendedArabicIndic = true;
    const prev = cps[i - 1], next = cps[i + 1];
    switch (cp2) {
      case 183:
        if (prev !== 108 || next !== 108)
          return false;
        break;
      // MIDDLE DOT (Catalan)
      case 885:
        if (next === void 0 || !IsGreek(next))
          return false;
        break;
      // Greek KERAIA
      case 1523:
      case 1524:
        if (prev === void 0 || !IsHebrew(prev))
          return false;
        break;
      // Hebrew GERESH
      case 8204:
        if (prev === void 0 || prev < 128 && !IsVirama(prev))
          return false;
        break;
      case 8205:
        if (prev === void 0 || !IsVirama(prev))
          return false;
        break;
      case 12539:
        break;
    }
  }
  if (value.includes("\u30FB") && !hasJapanese)
    return false;
  if (hasArabicIndic && hasExtendedArabicIndic)
    return false;
  return true;
}
function IsAsciiLabel(value) {
  if (value.charCodeAt(0) === 45 || value.charCodeAt(value.length - 1) === 45)
    return false;
  if (value.length >= 4 && value.charCodeAt(2) === 45 && value.charCodeAt(3) === 45)
    return false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (!(ch >= 97 && ch <= 122 || // a-z
    ch >= 65 && ch <= 90 || // A-Z
    ch >= 48 && ch <= 57 || // 0-9
    ch === 45))
      return false;
  }
  return true;
}
function IsPuny(value) {
  return value.toLowerCase().startsWith("xn--");
}
function IsPunyLabel(value) {
  try {
    const payload = value.slice(4).toLowerCase();
    const lastHyphen = payload.lastIndexOf("-");
    if (lastHyphen === 0) {
      return false;
    }
    const decoded = Decode2(payload);
    if (!decoded)
      return false;
    return IsUnicodeLabel(decoded);
  } catch {
    return false;
  }
}
function IsIdnLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsUnicodeLabel(value);
}
function IsLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsAsciiLabel(value);
}
var RFC5892_DISALLOWED, VIRAMA_CPS;
var init_idna = __esm({
  "node_modules/typebox/build/format/_idna.mjs"() {
    init_unreachable2();
    init_puny();
    RFC5892_DISALLOWED = /* @__PURE__ */ new Set([
      1600,
      // ARABIC TATWEEL
      2042,
      // NKO LAJANYALAN
      12334,
      // HANGUL SINGLE DOT TONE MARK
      12335,
      // HANGUL DOUBLE DOT TONE MARK
      12337,
      // VERTICAL KANA REPEAT MARK
      12338,
      // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK
      12339,
      // VERTICAL KANA REPEAT MARK UPPER HALF
      12340,
      // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK UPPER HALF
      12341,
      // VERTICAL KANA REPEAT MARK LOWER HALF
      12347
      // VERTICAL IDEOGRAPHIC ITERATION MARK
    ]);
    VIRAMA_CPS = /* @__PURE__ */ new Set([
      2381,
      2509,
      2637,
      2765,
      2893,
      3021,
      3149,
      3277,
      3387,
      3388,
      3405,
      3530,
      6980,
      7082,
      7083,
      43456,
      69702,
      69759,
      69817,
      69939,
      69940,
      70080,
      70197,
      70477,
      70722,
      70850,
      71103,
      71231,
      71350,
      72767,
      73028,
      73029
    ]);
  }
});

// node_modules/typebox/build/format/hostname.mjs
function IsHostname(value) {
  if (value.length === 0 || value.length > 253)
    return false;
  if (value.charCodeAt(value.length - 1) === 46)
    return false;
  for (const label of value.split(".")) {
    if (!IsLabel(label))
      return false;
  }
  return true;
}
var init_hostname = __esm({
  "node_modules/typebox/build/format/hostname.mjs"() {
    init_idna();
  }
});

// node_modules/typebox/build/format/idn_email.mjs
function IsIdnEmail(value) {
  return IdnEmail.test(value);
}
var IdnEmail;
var init_idn_email = __esm({
  "node_modules/typebox/build/format/idn_email.mjs"() {
    IdnEmail = /^(?!.*\.\.)[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)*$/iu;
  }
});

// node_modules/typebox/build/format/idn_hostname.mjs
function IsIdnHostname(value) {
  if (value.length === 0 || value.includes(" "))
    return false;
  const canonical = value.normalize("NFC").replace(/[\u002E\u3002\uFF0E\uFF61]/g, ".");
  if (canonical.length > 253)
    return false;
  for (const label of canonical.split(".")) {
    if (!IsIdnLabel(label))
      return false;
  }
  return true;
}
var init_idn_hostname = __esm({
  "node_modules/typebox/build/format/idn_hostname.mjs"() {
    init_idna();
  }
});

// node_modules/typebox/build/format/ipv4.mjs
function IsIPv4Internal(value, start, end) {
  let dots = 0;
  let num = 0;
  let digits = 0;
  let leading = 0;
  for (let i = start; i < end; i++) {
    const ch = value.charCodeAt(i);
    if (ch === 46) {
      if (digits === 0 || num > 255 || leading === 48 && digits > 1)
        return false;
      dots++;
      num = 0;
      digits = 0;
      leading = 0;
    } else if (ch >= 48 && ch <= 57) {
      if (digits === 0)
        leading = ch;
      num = num * 10 + (ch - 48);
      digits++;
    } else {
      return false;
    }
  }
  return dots === 3 && digits > 0 && num <= 255 && !(leading === 48 && digits > 1);
}
function IsIPv4(value) {
  return IsIPv4Internal(value, 0, value.length);
}
var init_ipv4 = __esm({
  "node_modules/typebox/build/format/ipv4.mjs"() {
  }
});

// node_modules/typebox/build/format/ipv6.mjs
function InRange(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsIPv6(value) {
  const length = value.length;
  if (length === 0)
    return false;
  let groups = 0;
  let compressed = false;
  let i = 0;
  if (value.charCodeAt(0) === 58 && value.charCodeAt(1) === 58) {
    if (length === 2)
      return true;
    compressed = true;
    i = 2;
  }
  while (i < length) {
    let digits = 0;
    const start = i;
    while (i < length && InRange(value.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (digits === 0)
      return false;
    const next = value.charCodeAt(i);
    if (next === 46) {
      if (!IsIPv4Internal(value, start, length))
        return false;
      groups += 2;
      i = length;
      break;
    }
    if (digits > 4)
      return false;
    groups++;
    if (i === length)
      break;
    if (next !== 58)
      return false;
    i++;
    if (value.charCodeAt(i) === 58) {
      if (compressed)
        return false;
      if (value.charCodeAt(i + 1) === 58)
        return false;
      compressed = true;
      i++;
      if (i === length)
        break;
    }
  }
  return compressed ? groups <= 7 : groups === 8;
}
var init_ipv6 = __esm({
  "node_modules/typebox/build/format/ipv6.mjs"() {
    init_ipv4();
  }
});

// node_modules/typebox/build/format/iri_reference.mjs
function TryUrl(value) {
  try {
    new URL(value, "http://example.com");
    return true;
  } catch {
    return false;
  }
}
function IsIriReference(value) {
  if (value.includes(" ")) {
    return false;
  }
  if (value.includes("\\")) {
    return false;
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return false;
  }
  if (/%(?![0-9a-fA-F]{2})/.test(value)) {
    return false;
  }
  if (value === "") {
    return true;
  }
  const colonIndex = value.indexOf(":");
  const hasValidSchemePrefix = colonIndex > 0 && // Colon must not be at the very beginning (e.g., ":foo")
  /^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(value.substring(0, colonIndex));
  if (hasValidSchemePrefix) {
    return TryUrl(value);
  } else {
    const looksLikeMalformedSchemeAndAuthority = value.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*)(\/\/)/);
    if (looksLikeMalformedSchemeAndAuthority && colonIndex === -1) {
      return false;
    }
    return TryUrl(value);
  }
}
var init_iri_reference = __esm({
  "node_modules/typebox/build/format/iri_reference.mjs"() {
  }
});

// node_modules/typebox/build/format/iri.mjs
function IsIri(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
var init_iri = __esm({
  "node_modules/typebox/build/format/iri.mjs"() {
  }
});

// node_modules/typebox/build/format/json_pointer_uri_fragment.mjs
function IsJsonPointerUriFragment(value) {
  return JsonPointerUriFragment.test(value);
}
var JsonPointerUriFragment;
var init_json_pointer_uri_fragment = __esm({
  "node_modules/typebox/build/format/json_pointer_uri_fragment.mjs"() {
    JsonPointerUriFragment = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
  }
});

// node_modules/typebox/build/format/json_pointer.mjs
function IsJsonPointer(value) {
  return JsonPointer.test(value);
}
var JsonPointer;
var init_json_pointer = __esm({
  "node_modules/typebox/build/format/json_pointer.mjs"() {
    JsonPointer = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
  }
});

// node_modules/typebox/build/format/regex.mjs
function IsRegex(value) {
  if (value.length === 0) {
    return false;
  }
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}
var init_regex = __esm({
  "node_modules/typebox/build/format/regex.mjs"() {
  }
});

// node_modules/typebox/build/format/relative_json_pointer.mjs
function IsRelativeJsonPointer(value) {
  return RelativeJsonPointer.test(value);
}
var RelativeJsonPointer;
var init_relative_json_pointer = __esm({
  "node_modules/typebox/build/format/relative_json_pointer.mjs"() {
    RelativeJsonPointer = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
  }
});

// node_modules/typebox/build/format/uri_reference.mjs
function IsUriReference(value) {
  return UriReference.test(value);
}
var UriReference;
var init_uri_reference = __esm({
  "node_modules/typebox/build/format/uri_reference.mjs"() {
    UriReference = /^(?!.*[^\x00-\x7F])(?!.*\\)(?:(?:[a-z][a-z0-9+\-.]*:)?(?:\/\/[^\s[\]{}<>^`|]*)?|[^\s[\]{}<>^`|]*)(?:\?[^\s[\]{}<>^`|]*)?(?:#[^\s[\]{}<>^`|]*)?$/i;
  }
});

// node_modules/typebox/build/format/uri_template.mjs
function IsUriTemplate(value) {
  return UriTemplate.test(value);
}
var UriTemplate;
var init_uri_template = __esm({
  "node_modules/typebox/build/format/uri_template.mjs"() {
    UriTemplate = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
  }
});

// node_modules/typebox/build/format/uri.mjs
function IsAlpha(ch) {
  return ch >= 97 && ch <= 122 || ch >= 65 && ch <= 90;
}
function IsAlphaNumeric(ch) {
  return IsAlpha(ch) || ch >= 48 && ch <= 57;
}
function IsHex(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsSchemeChar(ch) {
  return IsAlphaNumeric(ch) || ch === 43 || ch === 45 || ch === 46;
}
function IsUnreserved(ch) {
  return IsAlphaNumeric(ch) || ch === 45 || ch === 46 || // '-', '.'
  ch === 95 || ch === 126;
}
function IsSubDelim(ch) {
  return ch === 33 || ch === 36 || ch === 38 || ch === 39 || ch === 40 || ch === 41 || ch === 42 || ch === 43 || ch === 44 || ch === 59 || ch === 61;
}
function IsPchar(ch) {
  return IsUnreserved(ch) || IsSubDelim(ch) || ch === 58 || ch === 64;
}
function IsUri(value) {
  const length = value.length;
  if (length === 0)
    return false;
  if (!IsAlpha(value.charCodeAt(0)))
    return false;
  let i = 1;
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 58)
      break;
    if (!IsSchemeChar(ch))
      return false;
    i++;
  }
  if (value.charCodeAt(i) !== 58)
    return false;
  i++;
  if (value.charCodeAt(i) === 47 && value.charCodeAt(i + 1) === 47) {
    i += 2;
    const authorityStart = i;
    let atPos = -1;
    for (let j = i; j < length; j++) {
      const ch = value.charCodeAt(j);
      if (ch === 64) {
        atPos = j;
        break;
      }
      if (ch === 47 || ch === 63 || ch === 35)
        break;
    }
    if (atPos !== -1) {
      for (let j = authorityStart; j < atPos; j++) {
        const ch = value.charCodeAt(j);
        if (ch === 91 || ch === 93)
          return false;
        if (ch === 37) {
          if (j + 2 >= atPos || !IsHex(value.charCodeAt(j + 1)) || !IsHex(value.charCodeAt(j + 2)))
            return false;
          j += 2;
        } else if (!IsUnreserved(ch) && !IsSubDelim(ch) && ch !== 58)
          return false;
      }
      i = atPos + 1;
    }
    if (value.charCodeAt(i) === 91) {
      i++;
      while (i < length && value.charCodeAt(i) !== 93)
        i++;
      if (value.charCodeAt(i) !== 93)
        return false;
      i++;
    } else {
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35 || ch === 58)
          break;
        if (ch < 128 && !IsUnreserved(ch) && !IsSubDelim(ch))
          return false;
        i++;
      }
    }
    if (value.charCodeAt(i) === 58) {
      i++;
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35)
          break;
        if (ch < 48 || ch > 57)
          return false;
        i++;
      }
    }
  }
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 37) {
      if (i + 2 >= length || !IsHex(value.charCodeAt(i + 1)) || !IsHex(value.charCodeAt(i + 2)))
        return false;
      i += 2;
    } else if (ch > 127) {
      return false;
    } else if (!(IsPchar(ch) || ch === 47 || ch === 63 || ch === 35)) {
      return false;
    }
    i++;
  }
  return true;
}
var init_uri = __esm({
  "node_modules/typebox/build/format/uri.mjs"() {
  }
});

// node_modules/typebox/build/format/url.mjs
function IsUrl(value) {
  return Url.test(value);
}
var Url;
var init_url = __esm({
  "node_modules/typebox/build/format/url.mjs"() {
    Url = /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
  }
});

// node_modules/typebox/build/format/uuid.mjs
function IsUuid(value) {
  return Uuid.test(value);
}
var Uuid;
var init_uuid = __esm({
  "node_modules/typebox/build/format/uuid.mjs"() {
    Uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  }
});

// node_modules/typebox/build/format/_registry.mjs
function Clear() {
  formats.clear();
}
function Entries2() {
  return [...formats.entries()];
}
function Set3(format, check) {
  formats.set(format, check);
}
function Has(format) {
  return formats.has(format);
}
function Get3(format) {
  return formats.get(format);
}
function Test(format, value) {
  return formats.get(format)?.(value) ?? true;
}
function Reset2() {
  Clear();
  formats.set("date-time", IsDateTime);
  formats.set("date", IsDate2);
  formats.set("duration", IsDuration);
  formats.set("email", IsEmail);
  formats.set("hostname", IsHostname);
  formats.set("idn-email", IsIdnEmail);
  formats.set("idn-hostname", IsIdnHostname);
  formats.set("ipv4", IsIPv4);
  formats.set("ipv6", IsIPv6);
  formats.set("iri-reference", IsIriReference);
  formats.set("iri", IsIri);
  formats.set("json-pointer-uri-fragment", IsJsonPointerUriFragment);
  formats.set("json-pointer", IsJsonPointer);
  formats.set("regex", IsRegex);
  formats.set("relative-json-pointer", IsRelativeJsonPointer);
  formats.set("time", IsTime);
  formats.set("uri-reference", IsUriReference);
  formats.set("uri-template", IsUriTemplate);
  formats.set("uri", IsUri);
  formats.set("url", IsUrl);
  formats.set("uuid", IsUuid);
}
var formats;
var init_registry = __esm({
  "node_modules/typebox/build/format/_registry.mjs"() {
    init_date_time();
    init_date();
    init_duration();
    init_email();
    init_hostname();
    init_idn_email();
    init_idn_hostname();
    init_ipv4();
    init_ipv6();
    init_iri_reference();
    init_iri();
    init_json_pointer_uri_fragment();
    init_json_pointer();
    init_regex();
    init_relative_json_pointer();
    init_time();
    init_uri_reference();
    init_uri_template();
    init_uri();
    init_url();
    init_uuid();
    formats = /* @__PURE__ */ new Map();
    Reset2();
  }
});

// node_modules/typebox/build/format/format.mjs
var format_exports = {};
__export(format_exports, {
  Clear: () => Clear,
  Entries: () => Entries2,
  Get: () => Get3,
  Has: () => Has,
  IsDate: () => IsDate2,
  IsDateTime: () => IsDateTime,
  IsDuration: () => IsDuration,
  IsEmail: () => IsEmail,
  IsHostname: () => IsHostname,
  IsIPv4: () => IsIPv4,
  IsIPv6: () => IsIPv6,
  IsIdnEmail: () => IsIdnEmail,
  IsIdnHostname: () => IsIdnHostname,
  IsIri: () => IsIri,
  IsIriReference: () => IsIriReference,
  IsJsonPointer: () => IsJsonPointer,
  IsJsonPointerUriFragment: () => IsJsonPointerUriFragment,
  IsRegex: () => IsRegex,
  IsRelativeJsonPointer: () => IsRelativeJsonPointer,
  IsTime: () => IsTime,
  IsUri: () => IsUri,
  IsUriReference: () => IsUriReference,
  IsUriTemplate: () => IsUriTemplate,
  IsUrl: () => IsUrl,
  IsUuid: () => IsUuid,
  Reset: () => Reset2,
  Set: () => Set3,
  Test: () => Test
});
var init_format2 = __esm({
  "node_modules/typebox/build/format/format.mjs"() {
    init_registry();
    init_date_time();
    init_date();
    init_duration();
    init_email();
    init_hostname();
    init_idn_email();
    init_idn_hostname();
    init_ipv4();
    init_ipv6();
    init_iri_reference();
    init_iri();
    init_json_pointer_uri_fragment();
    init_json_pointer();
    init_regex();
    init_relative_json_pointer();
    init_time();
    init_uri_reference();
    init_uri_template();
    init_uri();
    init_url();
    init_uuid();
  }
});

// node_modules/typebox/build/format/index.mjs
var init_format3 = __esm({
  "node_modules/typebox/build/format/index.mjs"() {
    init_format2();
    init_format2();
    init_format2();
  }
});

// node_modules/typebox/build/schema/engine/format.mjs
function CheckFormat(_stack, _context, schema, value) {
  return format_exports.Test(schema.format, value);
}
function ErrorFormat(stack, context, schemaPath, instancePath, schema, value) {
  return CheckFormat(stack, context, schema, value) || context.AddError({
    keyword: "format",
    schemaPath,
    instancePath,
    params: { format: schema.format }
  });
}
var init_format4 = __esm({
  "node_modules/typebox/build/schema/engine/format.mjs"() {
    init_format3();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/if.mjs
function CheckIf(stack, context, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  return CheckSchema(stack, context, schema.if, value) ? CheckSchema(stack, context, thenSchema, value) : CheckSchema(stack, context, elseSchema, value);
}
function ErrorIf(stack, context, schemaPath, instancePath, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  const trueContext = new AccumulatedErrorContext();
  const isIf = ErrorSchema(stack, trueContext, `${schemaPath}/if`, instancePath, schema.if, value) ? ErrorSchema(stack, trueContext, `${schemaPath}/then`, instancePath, thenSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "then" }
  }) : ErrorSchema(stack, context, `${schemaPath}/else`, instancePath, elseSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "else" }
  });
  if (isIf)
    context.Merge([trueContext]);
  return isIf;
}
var init_if2 = __esm({
  "node_modules/typebox/build/schema/engine/if.mjs"() {
    init_types2();
    init_context();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/items.mjs
function CheckItemsSized(stack, context, schema, value) {
  return guard_exports.Every(schema.items, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema.items, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/items/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}
function CheckItemsUnsized(stack, context, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.Every(value, offset, (element, index) => {
    return CheckSchemaPushStack(stack, context, schema.items, element) && context.AddIndex(index);
  });
}
function ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.EveryAll(value, offset, (element, index) => {
    const nextSchemaPath = `${schemaPath}/items`;
    const nextInstancePath = `${instancePath}/${index}`;
    return ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.items, element) && context.AddIndex(index);
  });
}
function CheckItems(stack, context, schema, value) {
  return IsItemsSized(schema) ? CheckItemsSized(stack, context, schema, value) : CheckItemsUnsized(stack, context, schema, value);
}
function ErrorItems(stack, context, schemaPath, instancePath, schema, value) {
  return IsItemsSized(schema) ? ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) : ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value);
}
var init_items2 = __esm({
  "node_modules/typebox/build/schema/engine/items.mjs"() {
    init_types2();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/maxContains.mjs
function IsValid3(schema) {
  return IsContains(schema);
}
function CheckMaxContains(stack, context, schema, value) {
  if (!IsValid3(schema))
    return true;
  const count = value.reduce((result, item) => CheckSchema(stack, context, schema.contains, item) ? ++result : result, 0);
  return guard_exports.IsLessEqualThan(count, schema.maxContains);
}
function ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value) {
  const minContains = IsMinContains(schema) ? schema.minContains : 1;
  return CheckMaxContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains, maxContains: schema.maxContains }
  });
}
var init_maxContains2 = __esm({
  "node_modules/typebox/build/schema/engine/maxContains.mjs"() {
    init_types2();
    init_unique();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/maximum.mjs
function CheckMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value, schema.maximum);
}
function ErrorMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaximum(stack, context, schema, value) || context.AddError({
    keyword: "maximum",
    schemaPath,
    instancePath,
    params: { comparison: "<=", limit: schema.maximum }
  });
}
var init_maximum2 = __esm({
  "node_modules/typebox/build/schema/engine/maximum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/maxItems.mjs
function CheckMaxItems(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value.length, schema.maxItems);
}
function ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxItems(stack, context, schema, value) || context.AddError({
    keyword: "maxItems",
    schemaPath,
    instancePath,
    params: { limit: schema.maxItems }
  });
}
var init_maxItems2 = __esm({
  "node_modules/typebox/build/schema/engine/maxItems.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/maxLength.mjs
function CheckMaxLength(_stack, _context, schema, value) {
  return guard_exports.IsMaxLength(value, schema.maxLength);
}
function ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxLength(stack, context, schema, value) || context.AddError({
    keyword: "maxLength",
    schemaPath,
    instancePath,
    params: { limit: schema.maxLength }
  });
}
var init_maxLength2 = __esm({
  "node_modules/typebox/build/schema/engine/maxLength.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/maxProperties.mjs
function CheckMaxProperties(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(guard_exports.Keys(value).length, schema.maxProperties);
}
function ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxProperties(stack, context, schema, value) || context.AddError({
    keyword: "maxProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.maxProperties }
  });
}
var init_maxProperties2 = __esm({
  "node_modules/typebox/build/schema/engine/maxProperties.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/minContains.mjs
function IsValid4(schema) {
  return IsContains(schema);
}
function CheckMinContains(stack, context, schema, value) {
  if (!IsValid4(schema))
    return true;
  const count = value.reduce((result, item) => CheckSchema(stack, context, schema.contains, item) ? ++result : result, 0);
  return guard_exports.IsGreaterEqualThan(count, schema.minContains);
}
function ErrorMinContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: schema.minContains }
  });
}
var init_minContains2 = __esm({
  "node_modules/typebox/build/schema/engine/minContains.mjs"() {
    init_types2();
    init_unique();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/minimum.mjs
function CheckMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value, schema.minimum);
}
function ErrorMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinimum(stack, context, schema, value) || context.AddError({
    keyword: "minimum",
    schemaPath,
    instancePath,
    params: { comparison: ">=", limit: schema.minimum }
  });
}
var init_minimum2 = __esm({
  "node_modules/typebox/build/schema/engine/minimum.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/minItems.mjs
function CheckMinItems(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value.length, schema.minItems);
}
function ErrorMinItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinItems(stack, context, schema, value) || context.AddError({
    keyword: "minItems",
    schemaPath,
    instancePath,
    params: { limit: schema.minItems }
  });
}
var init_minItems2 = __esm({
  "node_modules/typebox/build/schema/engine/minItems.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/minLength.mjs
function CheckMinLength(_stack, _context, schema, value) {
  return guard_exports.IsMinLength(value, schema.minLength);
}
function ErrorMinLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinLength(stack, context, schema, value) || context.AddError({
    keyword: "minLength",
    schemaPath,
    instancePath,
    params: { limit: schema.minLength }
  });
}
var init_minLength2 = __esm({
  "node_modules/typebox/build/schema/engine/minLength.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/minProperties.mjs
function CheckMinProperties(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(guard_exports.Keys(value).length, schema.minProperties);
}
function ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinProperties(stack, context, schema, value) || context.AddError({
    keyword: "minProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.minProperties }
  });
}
var init_minProperties2 = __esm({
  "node_modules/typebox/build/schema/engine/minProperties.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/multipleOf.mjs
function CheckMultipleOf(_stack, _context, schema, value) {
  return guard_exports.IsMultipleOf(value, schema.multipleOf);
}
function ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMultipleOf(stack, context, schema, value) || context.AddError({
    keyword: "multipleOf",
    schemaPath,
    instancePath,
    params: { multipleOf: schema.multipleOf }
  });
}
var init_multipleOf2 = __esm({
  "node_modules/typebox/build/schema/engine/multipleOf.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/not.mjs
function CheckNot(stack, context, schema, value) {
  const nextContext = new CheckContext();
  const isSchema = !CheckSchema(stack, nextContext, schema.not, value);
  const isNot = isSchema && context.Merge([nextContext]);
  return isNot;
}
function ErrorNot(stack, context, schemaPath, instancePath, schema, value) {
  return CheckNot(stack, context, schema, value) || context.AddError({
    keyword: "not",
    schemaPath,
    instancePath,
    params: {}
  });
}
var init_not2 = __esm({
  "node_modules/typebox/build/schema/engine/not.mjs"() {
    init_context();
    init_reducer();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/oneOf.mjs
function CheckOneOf(stack, context, schema, value) {
  const passedContexts = schema.oneOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
}
function ErrorOneOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const passingSchemas = [];
  const passedContexts = schema.oneOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/oneOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (isSchema)
      passingSchemas.push(index);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isOneOf = guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
  if (!isOneOf && guard_exports.IsEqual(passingSchemas.length, 0))
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isOneOf || context.AddError({
    keyword: "oneOf",
    schemaPath,
    instancePath,
    params: { passingSchemas }
  });
}
var init_oneOf2 = __esm({
  "node_modules/typebox/build/schema/engine/oneOf.mjs"() {
    init_context();
    init_reducer();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/pattern.mjs
function CheckPattern(_stack, _context, schema, value) {
  const regexp = guard_exports.IsString(schema.pattern) ? new RegExp(schema.pattern, "u") : schema.pattern;
  return regexp.test(value);
}
function ErrorPattern(stack, context, schemaPath, instancePath, schema, value) {
  return CheckPattern(stack, context, schema, value) || context.AddError({
    keyword: "pattern",
    schemaPath,
    instancePath,
    params: { pattern: schema.pattern }
  });
}
var init_pattern3 = __esm({
  "node_modules/typebox/build/schema/engine/pattern.mjs"() {
    init_externals();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/patternProperties.mjs
function CheckPatternProperties(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const regexp = new RegExp(pattern, "u");
    return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
      return !regexp.test(key) || CheckSchemaPushStack(stack, context, schema2, prop) && context.AddKey(key);
    });
  });
}
function ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const nextSchemaPath = `${schemaPath}/patternProperties/${pattern}`;
    const regexp = new RegExp(pattern, "u");
    return guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, value2]) => {
      const nextInstancePath = `${instancePath}/${key}`;
      const notKey = !regexp.test(key);
      return notKey || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value2) && context.AddKey(key);
    });
  });
}
var init_patternProperties2 = __esm({
  "node_modules/typebox/build/schema/engine/patternProperties.mjs"() {
    init_externals();
    init_unique();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/prefixItems.mjs
function CheckPrefixItems(stack, context, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.Every(schema.prefixItems, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.EveryAll(schema.prefixItems, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/prefixItems/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}
var init_prefixItems2 = __esm({
  "node_modules/typebox/build/schema/engine/prefixItems.mjs"() {
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/_exact_optional.mjs
function IsExactOptional(required, key) {
  return required.includes(key) || settings_exports.Get().exactOptionalPropertyTypes;
}
function InexactOptionalCheck(value, key) {
  return guard_exports.IsUndefined(value[key]);
}
var init_exact_optional = __esm({
  "node_modules/typebox/build/schema/engine/_exact_optional.mjs"() {
    init_settings2();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/properties.mjs
function CheckProperties(stack, context, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.Every(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const isProperty = !guard_exports.HasPropertyKey(value, key) || CheckSchemaPushStack(stack, context, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty : InexactOptionalCheck(value, key) || isProperty;
  });
  return isProperties;
}
function ErrorProperties(stack, context, schemaPath, instancePath, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.EveryAll(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/properties/${key}`;
    const nextInstancePath = `${instancePath}/${key}`;
    const isProperty = () => !guard_exports.HasPropertyKey(value, key) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty() : InexactOptionalCheck(value, key) || isProperty();
  });
  return isProperties;
}
var init_properties3 = __esm({
  "node_modules/typebox/build/schema/engine/properties.mjs"() {
    init_types2();
    init_guard2();
    init_schema3();
    init_exact_optional();
  }
});

// node_modules/typebox/build/schema/engine/propertyNames.mjs
function CheckPropertyNames(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => CheckSchema(stack, context, schema.propertyNames, key));
}
function ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value) {
  const propertyNames = [];
  const isPropertyNames = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextInstancePath = `${instancePath}/${key}`;
    const nextSchemaPath = `${schemaPath}/propertyNames`;
    const nextContext = new AccumulatedErrorContext();
    const isPropertyName = ErrorSchema(stack, nextContext, nextSchemaPath, nextInstancePath, schema.propertyNames, key);
    if (!isPropertyName)
      propertyNames.push(key);
    return isPropertyName;
  });
  return isPropertyNames || context.AddError({
    keyword: "propertyNames",
    schemaPath,
    instancePath,
    params: { propertyNames }
  });
}
var init_propertyNames2 = __esm({
  "node_modules/typebox/build/schema/engine/propertyNames.mjs"() {
    init_unique();
    init_context();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/recursiveRef.mjs
function CheckRecursiveRef(stack, context, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema2(target) && CheckSchema(stack, context, target, value);
}
function ErrorRecursiveRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}
var init_recursiveRef2 = __esm({
  "node_modules/typebox/build/schema/engine/recursiveRef.mjs"() {
    init_functions();
    init_types2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/ref.mjs
function CheckRef(stack, context, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new CheckContext();
  const result = IsSchema2(target) && CheckSchema(stack, nextContext, target, value);
  if (result)
    context.Merge([nextContext]);
  return result;
}
function ErrorRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new AccumulatedErrorContext();
  const result = IsSchema2(target) && ErrorSchema(stack, nextContext, "#", instancePath, target, value);
  if (result)
    context.Merge([nextContext]);
  if (!result)
    nextContext.GetErrors().forEach((error) => context.AddError(error));
  return result;
}
var init_ref4 = __esm({
  "node_modules/typebox/build/schema/engine/ref.mjs"() {
    init_functions();
    init_types2();
    init_context();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/required.mjs
function CheckRequired(_stack, _context, schema, value) {
  return guard_exports.Every(schema.required, 0, (key) => guard_exports.HasPropertyKey(value, key));
}
function ErrorRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const requiredProperties = [];
  const isRequired = guard_exports.EveryAll(schema.required, 0, (key) => {
    const hasKey = guard_exports.HasPropertyKey(value, key);
    if (!hasKey)
      requiredProperties.push(key);
    return hasKey;
  });
  return isRequired || context.AddError({
    keyword: "required",
    schemaPath,
    instancePath,
    params: { requiredProperties }
  });
}
var init_required4 = __esm({
  "node_modules/typebox/build/schema/engine/required.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/type.mjs
function CheckTypeName(_stack, _context, type, _schema, value) {
  return (
    // jsonschema
    guard_exports.IsEqual(type, "object") ? guard_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type, "array") ? guard_exports.IsArray(value) : guard_exports.IsEqual(type, "boolean") ? guard_exports.IsBoolean(value) : guard_exports.IsEqual(type, "integer") ? guard_exports.IsInteger(value) : guard_exports.IsEqual(type, "number") ? guard_exports.IsNumber(value) : guard_exports.IsEqual(type, "null") ? guard_exports.IsNull(value) : guard_exports.IsEqual(type, "string") ? guard_exports.IsString(value) : (
      // xschema
      guard_exports.IsEqual(type, "bigint") ? guard_exports.IsBigInt(value) : guard_exports.IsEqual(type, "constructor") ? guard_exports.IsConstructor(value) : guard_exports.IsEqual(type, "function") ? guard_exports.IsFunction(value) : guard_exports.IsEqual(type, "symbol") ? guard_exports.IsSymbol(value) : guard_exports.IsEqual(type, "undefined") ? guard_exports.IsUndefined(value) : guard_exports.IsEqual(type, "void") ? guard_exports.IsUndefined(value) : true
    )
  );
}
function CheckTypeNames(stack, context, types, schema, value) {
  return types.some((type) => CheckTypeName(stack, context, type, schema, value));
}
function CheckType(stack, context, schema, value) {
  return guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
}
function ErrorType(stack, context, schemaPath, instancePath, schema, value) {
  const isType = guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
  return isType || context.AddError({
    keyword: "type",
    schemaPath,
    instancePath,
    params: { type: schema.type }
  });
}
var init_type2 = __esm({
  "node_modules/typebox/build/schema/engine/type.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/unevaluatedItems.mjs
function CheckUnevaluatedItems(stack, context, schema, value) {
  const indices = context.GetIndices();
  return guard_exports.Every(value, 0, (item, index) => {
    return (indices.has(index) || CheckSchema(stack, context, schema.unevaluatedItems, item)) && context.AddIndex(index);
  });
}
function ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value) {
  const indices = context.GetIndices();
  const unevaluatedItems = [];
  const isUnevaluatedItems = guard_exports.EveryAll(value, 0, (item, index) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedItem = (indices.has(index) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedItems, item)) && context.AddIndex(index);
    if (!isEvaluatedItem)
      unevaluatedItems.push(index);
    return isEvaluatedItem;
  });
  return isUnevaluatedItems || context.AddError({
    keyword: "unevaluatedItems",
    schemaPath,
    instancePath,
    params: { unevaluatedItems }
  });
}
var init_unevaluatedItems2 = __esm({
  "node_modules/typebox/build/schema/engine/unevaluatedItems.mjs"() {
    init_unique();
    init_context();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/unevaluatedProperties.mjs
function CheckUnevaluatedProperties(stack, context, schema, value) {
  const keys = context.GetKeys();
  return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
    return keys.has(key) || CheckSchema(stack, context, schema.unevaluatedProperties, prop) && context.AddKey(key);
  });
}
function ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value) {
  const keys = context.GetKeys();
  const unevaluatedProperties = [];
  const isUnevaluatedProperties = guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, prop]) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedProperty = keys.has(key) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedProperties, prop) && context.AddKey(key);
    if (!isEvaluatedProperty)
      unevaluatedProperties.push(key);
    return isEvaluatedProperty;
  });
  return isUnevaluatedProperties || context.AddError({
    keyword: "unevaluatedProperties",
    schemaPath,
    instancePath,
    params: { unevaluatedProperties }
  });
}
var init_unevaluatedProperties2 = __esm({
  "node_modules/typebox/build/schema/engine/unevaluatedProperties.mjs"() {
    init_unique();
    init_context();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/engine/uniqueItems.mjs
function IsValid5(schema) {
  return !guard_exports.IsEqual(schema.uniqueItems, false);
}
function CheckUniqueItems(_stack, _context, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = new Set(value.map(hash_exports.Hash)).size;
  const isLength = value.length;
  return guard_exports.IsEqual(set, isLength);
}
function ErrorUniqueItems(_stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = /* @__PURE__ */ new Set();
  const duplicateItems = value.reduce((result, value2, index) => {
    const hash = hash_exports.Hash(value2);
    if (set.has(hash))
      return [...result, index];
    set.add(hash);
    return result;
  }, []);
  const isUniqueItems = guard_exports.IsEqual(duplicateItems.length, 0);
  return isUniqueItems || context.AddError({
    keyword: "uniqueItems",
    schemaPath,
    instancePath,
    params: { duplicateItems }
  });
}
var init_uniqueItems2 = __esm({
  "node_modules/typebox/build/schema/engine/uniqueItems.mjs"() {
    init_hashing();
    init_guard2();
  }
});

// node_modules/typebox/build/schema/engine/schema.mjs
function CheckSchemaPushStack(stack, context, schema, value) {
  return context.Push() && CheckSchema(stack, context, schema, value) && context.Pop();
}
function CheckSchema(stack, context, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? CheckSchemaBoolean(stack, context, schema, value) : (!IsType(schema) || CheckType(stack, context, schema, value)) && (!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || (!IsRequired(schema) || CheckRequired(stack, context, schema, value)) && (!IsAdditionalProperties(schema) || CheckAdditionalProperties(stack, context, schema, value)) && (!IsDependencies(schema) || CheckDependencies(stack, context, schema, value)) && (!IsDependentRequired(schema) || CheckDependentRequired(stack, context, schema, value)) && (!IsDependentSchemas(schema) || CheckDependentSchemas(stack, context, schema, value)) && (!IsPatternProperties(schema) || CheckPatternProperties(stack, context, schema, value)) && (!IsProperties(schema) || CheckProperties(stack, context, schema, value)) && (!IsPropertyNames(schema) || CheckPropertyNames(stack, context, schema, value)) && (!IsMinProperties(schema) || CheckMinProperties(stack, context, schema, value)) && (!IsMaxProperties(schema) || CheckMaxProperties(stack, context, schema, value))) && (!guard_exports.IsArray(value) || (!IsAdditionalItems(schema) || CheckAdditionalItems(stack, context, schema, value)) && (!IsContains(schema) || CheckContains(stack, context, schema, value)) && (!IsItems(schema) || CheckItems(stack, context, schema, value)) && (!IsMaxContains(schema) || CheckMaxContains(stack, context, schema, value)) && (!IsMaxItems(schema) || CheckMaxItems(stack, context, schema, value)) && (!IsMinContains(schema) || CheckMinContains(stack, context, schema, value)) && (!IsMinItems(schema) || CheckMinItems(stack, context, schema, value)) && (!IsPrefixItems(schema) || CheckPrefixItems(stack, context, schema, value)) && (!IsUniqueItems(schema) || CheckUniqueItems(stack, context, schema, value))) && (!guard_exports.IsString(value) || (!IsMaxLength3(schema) || CheckMaxLength(stack, context, schema, value)) && (!IsMinLength3(schema) || CheckMinLength(stack, context, schema, value)) && (!IsFormat(schema) || CheckFormat(stack, context, schema, value)) && (!IsPattern(schema) || CheckPattern(stack, context, schema, value))) && (!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || (!IsExclusiveMaximum(schema) || CheckExclusiveMaximum(stack, context, schema, value)) && (!IsExclusiveMinimum(schema) || CheckExclusiveMinimum(stack, context, schema, value)) && (!IsMaximum(schema) || CheckMaximum(stack, context, schema, value)) && (!IsMinimum(schema) || CheckMinimum(stack, context, schema, value)) && (!IsMultipleOf2(schema) || CheckMultipleOf(stack, context, schema, value))) && (!IsRef2(schema) || CheckRef(stack, context, schema, value)) && (!IsRecursiveRef(schema) || CheckRecursiveRef(stack, context, schema, value)) && (!IsDynamicRef(schema) || CheckDynamicRef(stack, context, schema, value)) && (!IsConst(schema) || CheckConst(stack, context, schema, value)) && (!IsEnum2(schema) || CheckEnum(stack, context, schema, value)) && (!IsIf(schema) || CheckIf(stack, context, schema, value)) && (!IsNot(schema) || CheckNot(stack, context, schema, value)) && (!IsAllOf(schema) || CheckAllOf(stack, context, schema, value)) && (!IsAnyOf(schema) || CheckAnyOf(stack, context, schema, value)) && (!IsOneOf(schema) || CheckOneOf(stack, context, schema, value)) && (!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || CheckUnevaluatedItems(stack, context, schema, value))) && (!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || CheckUnevaluatedProperties(stack, context, schema, value))) && (!IsRefine2(schema) || CheckRefine(stack, context, schema, value));
  stack.Pop(schema);
  return result;
}
function ErrorSchemaPushStack(stack, context, schemaPath, instancePath, schema, value) {
  return context.Push() && ErrorSchema(stack, context, schemaPath, instancePath, schema, value) && context.Pop();
}
function ErrorSchema(stack, context, schemaPath, instancePath, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) : !!(+(!IsType(schema) || ErrorType(stack, context, schemaPath, instancePath, schema, value)) & +(!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || !!(+(!IsRequired(schema) || ErrorRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAdditionalProperties(schema) || ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependencies(schema) || ErrorDependencies(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentRequired(schema) || ErrorDependentRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentSchemas(schema) || ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPatternProperties(schema) || ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsProperties(schema) || ErrorProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPropertyNames(schema) || ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinProperties(schema) || ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxProperties(schema) || ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsArray(value) || !!(+(!IsAdditionalItems(schema) || ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsContains(schema) || ErrorContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsItems(schema) || ErrorItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxContains(schema) || ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxItems(schema) || ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinContains(schema) || ErrorMinContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinItems(schema) || ErrorMinItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPrefixItems(schema) || ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUniqueItems(schema) || ErrorUniqueItems(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsString(value) || !!(+(!IsMaxLength3(schema) || ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinLength3(schema) || ErrorMinLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsFormat(schema) || ErrorFormat(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPattern(schema) || ErrorPattern(stack, context, schemaPath, instancePath, schema, value)))) & +(!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || !!(+(!IsExclusiveMaximum(schema) || ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsExclusiveMinimum(schema) || ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaximum(schema) || ErrorMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinimum(schema) || ErrorMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMultipleOf2(schema) || ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value)))) & +(!IsRef2(schema) || ErrorRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsRecursiveRef(schema) || ErrorRecursiveRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDynamicRef(schema) || ErrorDynamicRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsConst(schema) || ErrorConst(stack, context, schemaPath, instancePath, schema, value)) & +(!IsEnum2(schema) || ErrorEnum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsIf(schema) || ErrorIf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsNot(schema) || ErrorNot(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAllOf(schema) || ErrorAllOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAnyOf(schema) || ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsOneOf(schema) || ErrorOneOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value))) & +(!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value)))) && (!IsRefine2(schema) || ErrorRefine(stack, context, schemaPath, instancePath, schema, value));
  stack.Pop(schema);
  return result;
}
var init_schema3 = __esm({
  "node_modules/typebox/build/schema/engine/schema.mjs"() {
    init_types2();
    init_refine3();
    init_guard2();
    init_additionalItems2();
    init_additionalProperties2();
    init_allOf2();
    init_anyOf2();
    init_boolean3();
    init_const3();
    init_contains2();
    init_dependencies3();
    init_dependentRequired2();
    init_dependentSchemas2();
    init_dynamicRef2();
    init_enum5();
    init_exclusiveMaximum2();
    init_exclusiveMinimum2();
    init_format4();
    init_if2();
    init_items2();
    init_maxContains2();
    init_maximum2();
    init_maxItems2();
    init_maxLength2();
    init_maxProperties2();
    init_minContains2();
    init_minimum2();
    init_minItems2();
    init_minLength2();
    init_minProperties2();
    init_multipleOf2();
    init_not2();
    init_oneOf2();
    init_pattern3();
    init_patternProperties2();
    init_prefixItems2();
    init_properties3();
    init_propertyNames2();
    init_recursiveRef2();
    init_ref4();
    init_required4();
    init_type2();
    init_unevaluatedItems2();
    init_unevaluatedProperties2();
    init_uniqueItems2();
  }
});

// node_modules/typebox/build/schema/engine/_functions.mjs
var init_functions = __esm({
  "node_modules/typebox/build/schema/engine/_functions.mjs"() {
    init_hashing();
    init_guard2();
    init_schema3();
  }
});

// node_modules/typebox/build/schema/pointer/pointer_get.mjs
var init_pointer_get = __esm({
  "node_modules/typebox/build/schema/pointer/pointer_get.mjs"() {
  }
});

// node_modules/typebox/build/schema/pointer/pointer.mjs
var pointer_exports = {};
__export(pointer_exports, {
  Delete: () => Delete,
  Get: () => Get4,
  Has: () => Has2,
  Indices: () => Indices,
  Set: () => Set4
});
function AssertNotRoot(indices) {
  if (indices.length === 0)
    throw Error("Cannot set root");
}
function AssertCanSet(value) {
  if (!guard_exports.IsObject(value))
    throw Error("Cannot set value");
}
function AssertIndex(index) {
  if (guard_exports.IsUnsafePropertyKey(index))
    throw Error("Pointer contains unsafe property key");
}
function AssertIndices(indices) {
  for (const index of indices)
    AssertIndex(index);
}
function IsNumericIndex(index) {
  return /^(0|[1-9]\d*)$/.test(index);
}
function TakeIndexRight(indices) {
  return [
    indices.slice(0, indices.length - 1),
    indices.slice(indices.length - 1)[0]
  ];
}
function HasIndex(index, value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, index);
}
function GetIndex(index, value) {
  return guard_exports.IsObject(value) && !guard_exports.IsUnsafePropertyKey(index) ? value[index] : void 0;
}
function GetIndices(indices, value) {
  return indices.reduce((value2, index) => GetIndex(index, value2), value);
}
function Indices(pointer) {
  if (guard_exports.IsEqual(pointer.length, 0))
    return [];
  const indices = pointer.split("/").map((index) => index.replace(/~1/g, "/").replace(/~0/g, "~"));
  return indices.length > 0 && indices[0] === "" ? indices.slice(1) : indices;
}
function Has2(value, pointer) {
  let current = value;
  return Indices(pointer).every((index) => {
    if (!HasIndex(index, current))
      return false;
    current = current[index];
    return true;
  });
}
function Get4(value, pointer) {
  const indices = Indices(pointer);
  return GetIndices(indices, value);
}
function Set4(value, pointer, next) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  parent[index] = next;
  return value;
}
function Delete(value, pointer) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  if (guard_exports.IsArray(parent) && IsNumericIndex(index)) {
    parent.splice(+index, 1);
  } else {
    delete parent[index];
  }
  return value;
}
var init_pointer = __esm({
  "node_modules/typebox/build/schema/pointer/pointer.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/schema/pointer/index.mjs
var init_pointer2 = __esm({
  "node_modules/typebox/build/schema/pointer/index.mjs"() {
    init_pointer_get();
    init_pointer();
  }
});

// node_modules/typebox/build/schema/resolve/ref.mjs
function MatchId(schema, base, ref) {
  if (schema.$id === ref.hash)
    return schema;
  const absoluteId = new URL(schema.$id, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  if (guard_exports.IsEqual(absoluteId.pathname, absoluteRef.pathname)) {
    return ref.hash.startsWith("#") ? MatchHash(schema, base, ref) : schema;
  }
  return void 0;
}
function MatchAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$anchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchDynamicAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$dynamicAnchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchHash(schema, _base, ref) {
  if (ref.href.endsWith("#"))
    return schema;
  if (!ref.hash.startsWith("#"))
    return void 0;
  const fragment = decodeURIComponent(ref.hash.slice(1));
  if (!fragment.startsWith("/"))
    return void 0;
  return pointer_exports.Get(schema, fragment);
}
function Match4(schema, base, ref) {
  if (IsId(schema)) {
    const result = MatchId(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsAnchor(schema)) {
    const result = MatchAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsDynamicAnchor(schema)) {
    const result = MatchDynamicAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  return MatchHash(schema, base, ref);
}
function FromArray6(schema, base, ref) {
  return schema.reduce((result, item) => {
    const match = FromValue3(item, base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromObject10(schema, base, ref) {
  return guard_exports.Keys(schema).reduce((result, key) => {
    const match = FromValue3(schema[key], base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromValue3(schema, base, ref) {
  const nextBase = IsSchemaObject(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
  if (IsSchemaObject(schema)) {
    const result = Match4(schema, nextBase, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (guard_exports.IsArray(schema))
    return FromArray6(schema, nextBase, ref);
  if (guard_exports.IsObject(schema))
    return FromObject10(schema, nextBase, ref);
  return void 0;
}
function Ref2(schema, ref) {
  const defaultBase = new URL("http://unknown/");
  const initialBase = IsId(schema) ? new URL(schema.$id, defaultBase.href) : defaultBase;
  const initialRef = new URL(ref, initialBase.href);
  return FromValue3(schema, initialBase, initialRef);
}
function DynamicRef(root, base, dynamicRef, dynamicAnchors) {
  const fragmentTarget = dynamicRef.$dynamicRef.startsWith("#") ? Ref2(base, dynamicRef.$dynamicRef) : Ref2(root, dynamicRef.$dynamicRef);
  if (guard_exports.IsUndefined(fragmentTarget))
    return void 0;
  if (!IsSchemaObject(fragmentTarget) || !IsDynamicAnchor(fragmentTarget))
    return fragmentTarget;
  const fragment = new URL(dynamicRef.$dynamicRef, "http://unknown/").hash;
  if (fragment.startsWith("#/"))
    return fragmentTarget;
  const anchorTarget = dynamicAnchors.find((anchor) => anchor.$dynamicAnchor === fragmentTarget.$dynamicAnchor);
  return anchorTarget ?? fragmentTarget;
}
var init_ref5 = __esm({
  "node_modules/typebox/build/schema/resolve/ref.mjs"() {
    init_guard2();
    init_pointer2();
    init_types2();
  }
});

// node_modules/typebox/build/schema/resolve/resolve.mjs
var resolve_exports = {};
__export(resolve_exports, {
  DynamicRef: () => DynamicRef,
  Ref: () => Ref2
});
var init_resolve = __esm({
  "node_modules/typebox/build/schema/resolve/resolve.mjs"() {
    init_ref5();
  }
});

// node_modules/typebox/build/schema/resolve/index.mjs
var init_resolve2 = __esm({
  "node_modules/typebox/build/schema/resolve/index.mjs"() {
    init_resolve();
  }
});

// node_modules/typebox/build/schema/engine/_stack.mjs
var __classPrivateFieldGet, _Stack_instances, _Stack_PushResourceAnchors, _Stack_PopResourceAnchors, _Stack_FromContext, _Stack_FromRef, Stack;
var init_stack = __esm({
  "node_modules/typebox/build/schema/engine/_stack.mjs"() {
    init_types2();
    init_guard2();
    init_resolve2();
    __classPrivateFieldGet = function(receiver, state, kind, f) {
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
      return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
    };
    Stack = class {
      constructor(context, schema) {
        _Stack_instances.add(this);
        this.context = context;
        this.schema = schema;
        this.ids = [];
        this.anchors = [];
        this.recursiveAnchors = [];
        this.dynamicAnchors = [];
      }
      // ----------------------------------------------------------------
      // Base
      // ----------------------------------------------------------------
      BaseURL() {
        return this.ids.reduce((result, schema) => new URL(schema.$id, result), new URL("http://unknown"));
      }
      Base() {
        return this.ids[this.ids.length - 1] ?? this.schema;
      }
      // ----------------------------------------------------------------
      // Stack
      // ----------------------------------------------------------------
      Push(schema) {
        if (!IsSchemaObject(schema))
          return;
        if (IsId(schema)) {
          this.ids.push(schema);
          __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors).call(this, schema);
        }
        if (IsAnchor(schema))
          this.anchors.push(schema);
        if (IsRecursiveAnchorTrue(schema))
          this.recursiveAnchors.push(schema);
        if (IsDynamicAnchor(schema))
          this.dynamicAnchors.push(schema);
      }
      Pop(schema) {
        if (!IsSchemaObject(schema))
          return;
        if (IsId(schema)) {
          this.ids.pop();
          __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors).call(this, schema);
        }
        if (IsAnchor(schema))
          this.anchors.pop();
        if (IsRecursiveAnchorTrue(schema))
          this.recursiveAnchors.pop();
        if (IsDynamicAnchor(schema))
          this.dynamicAnchors.pop();
      }
      Ref(ref) {
        return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromContext).call(this, ref) ?? __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromRef).call(this, ref);
      }
      // ----------------------------------------------------------------
      // RecursiveRef
      // ----------------------------------------------------------------
      RecursiveRef(recursiveRef) {
        return IsRecursiveAnchorTrue(this.Base()) ? resolve_exports.Ref(this.recursiveAnchors[0], recursiveRef.$recursiveRef) : resolve_exports.Ref(this.Base(), recursiveRef.$recursiveRef);
      }
      // ----------------------------------------------------------------
      // DynamicRef
      // ----------------------------------------------------------------
      DynamicRef(dynamicRef) {
        const root = this.schema;
        return resolve_exports.DynamicRef(root, this.Base(), dynamicRef, this.dynamicAnchors);
      }
    };
    _Stack_instances = /* @__PURE__ */ new WeakSet(), _Stack_PushResourceAnchors = function _Stack_PushResourceAnchors2(schema, isRoot = true) {
      if (!IsSchemaObject(schema))
        return;
      const current = schema;
      if (!isRoot && IsId(current))
        return;
      if (!isRoot && IsDynamicAnchor(current))
        this.dynamicAnchors.push(current);
      for (const key of guard_exports.Keys(current))
        __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors2).call(this, current[key], false);
    }, _Stack_PopResourceAnchors = function _Stack_PopResourceAnchors2(schema, isRoot = true) {
      if (!IsSchemaObject(schema))
        return;
      const current = schema;
      if (!isRoot && IsId(current))
        return;
      if (!isRoot && IsDynamicAnchor(current))
        this.dynamicAnchors.pop();
      for (const key of guard_exports.Keys(current))
        __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors2).call(this, current[key], false);
    }, _Stack_FromContext = function _Stack_FromContext2(ref) {
      return guard_exports.HasPropertyKey(this.context, ref.$ref) ? this.context[ref.$ref] : void 0;
    }, _Stack_FromRef = function _Stack_FromRef2(ref) {
      const root = this.schema;
      return !ref.$ref.startsWith("#") ? resolve_exports.Ref(root, ref.$ref) : resolve_exports.Ref(this.Base(), ref.$ref);
    };
  }
});

// node_modules/typebox/build/schema/engine/index.mjs
var init_engine2 = __esm({
  "node_modules/typebox/build/schema/engine/index.mjs"() {
    init_context();
    init_externals();
    init_functions();
    init_reducer();
    init_refine3();
    init_stack();
    init_additionalItems2();
    init_additionalProperties2();
    init_allOf2();
    init_anyOf2();
    init_boolean3();
    init_const3();
    init_contains2();
    init_dependencies3();
    init_dependentRequired2();
    init_dependentSchemas2();
    init_enum5();
    init_exclusiveMaximum2();
    init_exclusiveMinimum2();
    init_format4();
    init_if2();
    init_items2();
    init_maxContains2();
    init_maxItems2();
    init_maxLength2();
    init_maxProperties2();
    init_maximum2();
    init_minContains2();
    init_minItems2();
    init_minLength2();
    init_minProperties2();
    init_minimum2();
    init_multipleOf2();
    init_not2();
    init_oneOf2();
    init_pattern3();
    init_patternProperties2();
    init_prefixItems2();
    init_properties3();
    init_propertyNames2();
    init_recursiveRef2();
    init_ref4();
    init_required4();
    init_schema3();
    init_type2();
    init_unevaluatedItems2();
    init_unevaluatedProperties2();
    init_uniqueItems2();
  }
});

// node_modules/typebox/build/schema/static/index.mjs
var init_static3 = __esm({
  "node_modules/typebox/build/schema/static/index.mjs"() {
  }
});

// node_modules/typebox/build/schema/build.mjs
var init_build2 = __esm({
  "node_modules/typebox/build/schema/build.mjs"() {
    init_arguments2();
    init_environment2();
    init_hashing();
    init_guard2();
    init_format3();
    init_engine2();
  }
});

// node_modules/typebox/build/schema/errors.mjs
function Errors(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const settings2 = settings_exports.Get();
  const locale2 = Get2();
  const errors = [];
  const stack = new Stack(context, schema);
  const errorContext = new ErrorContext((error) => {
    if (guard_exports.IsGreaterEqualThan(errors.length, settings2.maxErrors))
      return;
    return errors.push({ ...error, message: locale2(error) });
  });
  const result = ErrorSchema(stack, errorContext, "#", "", schema, value);
  return [result, errors];
}
var init_errors = __esm({
  "node_modules/typebox/build/schema/errors.mjs"() {
    init_arguments2();
    init_settings2();
    init_config();
    init_guard2();
    init_engine2();
  }
});

// node_modules/typebox/build/schema/check.mjs
function Check(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const stack = new Stack(context, schema);
  const checkContext = new CheckContext();
  return CheckSchema(stack, checkContext, schema, value);
}
var init_check2 = __esm({
  "node_modules/typebox/build/schema/check.mjs"() {
    init_arguments2();
    init_engine2();
  }
});

// node_modules/typebox/build/schema/parse.mjs
var init_parse = __esm({
  "node_modules/typebox/build/schema/parse.mjs"() {
    init_arguments2();
    init_check2();
    init_errors();
  }
});

// node_modules/typebox/build/schema/compile.mjs
var init_compile = __esm({
  "node_modules/typebox/build/schema/compile.mjs"() {
    init_arguments2();
    init_build2();
    init_errors();
    init_parse();
  }
});

// node_modules/typebox/build/schema/schema.mjs
var init_schema4 = __esm({
  "node_modules/typebox/build/schema/schema.mjs"() {
    init_engine2();
    init_pointer2();
    init_resolve2();
    init_static3();
    init_types2();
    init_build2();
    init_compile();
    init_check2();
    init_parse();
    init_errors();
  }
});

// node_modules/typebox/build/schema/index.mjs
var init_schema5 = __esm({
  "node_modules/typebox/build/schema/index.mjs"() {
    init_schema4();
    init_schema4();
  }
});

// node_modules/typebox/build/value/check/check.mjs
function Check2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Check(context, type, value);
}
var init_check3 = __esm({
  "node_modules/typebox/build/value/check/check.mjs"() {
    init_arguments2();
    init_schema5();
  }
});

// node_modules/typebox/build/value/check/index.mjs
var init_check4 = __esm({
  "node_modules/typebox/build/value/check/index.mjs"() {
    init_check3();
  }
});

// node_modules/typebox/build/value/errors/errors.mjs
function Errors2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const [_, errors] = Errors(context, type, value);
  return errors;
}
var init_errors2 = __esm({
  "node_modules/typebox/build/value/errors/errors.mjs"() {
    init_arguments2();
    init_schema5();
  }
});

// node_modules/typebox/build/value/errors/index.mjs
var init_errors3 = __esm({
  "node_modules/typebox/build/value/errors/index.mjs"() {
    init_errors2();
  }
});

// node_modules/typebox/build/value/assert/assert.mjs
function Assert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const check = Check2(context, type, value);
  if (!check)
    throw new AssertError("Assert", value, Errors2(context, type, value));
}
var AssertError;
var init_assert = __esm({
  "node_modules/typebox/build/value/assert/assert.mjs"() {
    init_arguments2();
    init_check4();
    init_errors3();
    AssertError = class extends Error {
      constructor(source, value, errors) {
        super(source);
        Object.defineProperty(this, "cause", {
          value: { source, errors, value },
          writable: false,
          configurable: false,
          enumerable: false
        });
      }
    };
  }
});

// node_modules/typebox/build/value/assert/index.mjs
var init_assert2 = __esm({
  "node_modules/typebox/build/value/assert/index.mjs"() {
    init_assert();
  }
});

// node_modules/typebox/build/type/index.mjs
var init_type3 = __esm({
  "node_modules/typebox/build/type/index.mjs"() {
    init_action();
    init_engine();
    init_extends3();
    init_script2();
    init_types();
  }
});

// node_modules/typebox/build/value/clean/from_array.mjs
function FromArray7(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  return value.map((value2) => FromType19(context, type.items, value2));
}
var init_from_array4 = __esm({
  "node_modules/typebox/build/value/clean/from_array.mjs"() {
    init_guard2();
    init_from_type11();
  }
});

// node_modules/typebox/build/value/clean/from_cyclic.mjs
function FromCyclic6(context, type, value) {
  return FromType19({ ...context, ...type.$defs }, Ref(type.$ref), value);
}
var init_from_cyclic6 = __esm({
  "node_modules/typebox/build/value/clean/from_cyclic.mjs"() {
    init_type3();
    init_from_type11();
  }
});

// node_modules/typebox/build/value/clean/from_intersect.mjs
function EvaluateIntersection(context, type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "unevaluatedProperties") ? { additionalProperties: type.unevaluatedProperties } : {};
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return IsObject2(evaluated) ? With2(evaluated, additionalProperties) : evaluated;
}
function FromIntersect6(context, type, value) {
  const evaluated = EvaluateIntersection(context, type);
  return FromType19(context, evaluated, value);
}
var init_from_intersect6 = __esm({
  "node_modules/typebox/build/value/clean/from_intersect.mjs"() {
    init_type3();
    init_guard2();
    init_from_type11();
  }
});

// node_modules/typebox/build/value/clean/additional.mjs
function GetAdditionalProperties(type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "additionalProperties") ? type.additionalProperties : void 0;
  return additionalProperties;
}
var init_additional = __esm({
  "node_modules/typebox/build/value/clean/additional.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/value/clean/from_object.mjs
function FromObject11(context, type, value) {
  if (!guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.HasPropertyKey(type.properties, key)) {
      value[key] = FromType19(context, type.properties[key], value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}
var init_from_object7 = __esm({
  "node_modules/typebox/build/value/clean/from_object.mjs"() {
    init_type3();
    init_guard2();
    init_from_type11();
    init_check4();
    init_additional();
  }
});

// node_modules/typebox/build/value/clean/from_record.mjs
function FromRecord3(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  const [recordPattern, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (recordPattern.test(key)) {
      value[key] = FromType19(context, recordValue, value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}
var init_from_record2 = __esm({
  "node_modules/typebox/build/value/clean/from_record.mjs"() {
    init_type3();
    init_guard2();
    init_from_type11();
    init_check4();
    init_additional();
  }
});

// node_modules/typebox/build/value/clean/from_ref.mjs
function FromRef5(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType19(context, context[type.$ref], value) : value;
}
var init_from_ref = __esm({
  "node_modules/typebox/build/value/clean/from_ref.mjs"() {
    init_guard2();
    init_from_type11();
  }
});

// node_modules/typebox/build/value/clean/from_tuple.mjs
function FromTuple5(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const length = Math.min(value.length, schema.items.length);
  for (let index = 0; index < length; index++) {
    value[index] = FromType19(context, schema.items[index], value[index]);
  }
  return guard_exports.IsGreaterThan(value.length, length) ? value.slice(0, length) : value;
}
var init_from_tuple5 = __esm({
  "node_modules/typebox/build/value/clean/from_tuple.mjs"() {
    init_guard2();
    init_from_type11();
  }
});

// node_modules/typebox/build/value/clone/clone.mjs
function Clone2(value) {
  return Clone(value);
}
var init_clone2 = __esm({
  "node_modules/typebox/build/value/clone/clone.mjs"() {
    init_clone();
  }
});

// node_modules/typebox/build/value/clone/index.mjs
var init_clone3 = __esm({
  "node_modules/typebox/build/value/clone/index.mjs"() {
    init_clone2();
  }
});

// node_modules/typebox/build/value/clean/from_union.mjs
function FromUnion9(context, type, value) {
  for (const schema of type.anyOf) {
    const clean = FromType19(context, schema, Clone2(value));
    if (Check2(context, schema, clean))
      return clean;
  }
  return value;
}
var init_from_union7 = __esm({
  "node_modules/typebox/build/value/clean/from_union.mjs"() {
    init_check4();
    init_clone3();
    init_from_type11();
  }
});

// node_modules/typebox/build/value/clean/from_type.mjs
function FromType19(context, type, value) {
  return IsArray2(type) ? FromArray7(context, type, value) : IsCyclic(type) ? FromCyclic6(context, type, value) : IsIntersect(type) ? FromIntersect6(context, type, value) : IsObject2(type) ? FromObject11(context, type, value) : IsRecord(type) ? FromRecord3(context, type, value) : IsRef(type) ? FromRef5(context, type, value) : IsTuple(type) ? FromTuple5(context, type, value) : IsUnion(type) ? FromUnion9(context, type, value) : value;
}
var init_from_type11 = __esm({
  "node_modules/typebox/build/value/clean/from_type.mjs"() {
    init_type3();
    init_from_array4();
    init_from_cyclic6();
    init_from_intersect6();
    init_from_object7();
    init_from_record2();
    init_from_ref();
    init_from_tuple5();
    init_from_union7();
  }
});

// node_modules/typebox/build/value/shared/union_priority_sort.mjs
function Modifiers(type, next) {
  for (const key of guard_default.Keys(type)) {
    if (guard_default.HasPropertyKey(next, key))
      continue;
    next[key] = type[key];
  }
  return next;
}
function FromProperties4(properties) {
  const result = {};
  for (const key of guard_default.Keys(properties))
    result[key] = FromType20(properties[key]);
  return result;
}
function FromPriorityTypes(types) {
  return FromTypes6(Priority(types));
}
function FromTypes6(types) {
  return types.map((type) => FromType20(type));
}
function FromType20(type) {
  const next = IsArray2(type) ? _Array_(FromType20(type.items), ArrayOptions(type)) : IsIntersect(type) ? Intersect(FromTypes6(type.allOf)) : IsUnion(type) ? Union(FromPriorityTypes(type.anyOf)) : IsObject2(type) ? _Object_(FromProperties4(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType20(RecordValue(type))) : IsTuple(type) ? Tuple(FromTypes6(type.items)) : type;
  return Modifiers(type, next);
}
function UnionPrioritySort(type) {
  const result = FromType20(type);
  return result;
}
var init_union_priority_sort = __esm({
  "node_modules/typebox/build/value/shared/union_priority_sort.mjs"() {
    init_guard2();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
  }
});

// node_modules/typebox/build/value/clean/clean.mjs
function Clean(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType19(context, sorted, value);
}
var init_clean = __esm({
  "node_modules/typebox/build/value/clean/clean.mjs"() {
    init_system2();
    init_from_type11();
    init_union_priority_sort();
  }
});

// node_modules/typebox/build/value/clean/index.mjs
var init_clean2 = __esm({
  "node_modules/typebox/build/value/clean/index.mjs"() {
    init_clean();
  }
});

// node_modules/typebox/build/value/convert/try/try_result.mjs
function IsOk(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "value");
}
function Ok(value) {
  return { value };
}
function Fail() {
  return void 0;
}
var init_try_result = __esm({
  "node_modules/typebox/build/value/convert/try/try_result.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/value/convert/try/try_array.mjs
function TryArray(value) {
  return guard_exports.IsArray(value) ? Ok(value) : Ok([value]);
}
var init_try_array = __esm({
  "node_modules/typebox/build/value/convert/try/try_array.mjs"() {
    init_guard2();
    init_try_result();
  }
});

// node_modules/typebox/build/value/convert/try/try_bigint.mjs
function FromBoolean2(value) {
  return guard_exports.IsEqual(value, true) ? Ok(BigInt(1)) : Ok(BigInt(0));
}
function IsStringBigIntLike(value) {
  return bigintPattern.test(value);
}
function IsStringDecimalLike(value) {
  return decimalPattern.test(value);
}
function IsStringIntegerLike(value) {
  return integerPattern.test(value);
}
function FromString2(value) {
  const lowercase = value.toLowerCase();
  return IsStringBigIntLike(value) ? Ok(BigInt(value.slice(0, value.length - 1))) : IsStringDecimalLike(value) ? Ok(BigInt(value.split(".")[0])) : IsStringIntegerLike(value) ? Ok(BigInt(value)) : guard_exports.IsEqual(lowercase, "false") ? Ok(BigInt(0)) : guard_exports.IsEqual(lowercase, "true") ? Ok(BigInt(1)) : Fail();
}
function TryBigInt(value) {
  return guard_exports.IsBigInt(value) ? Ok(value) : guard_exports.IsBoolean(value) ? FromBoolean2(value) : guard_exports.IsNumber(value) ? Ok(BigInt(Math.trunc(value))) : guard_exports.IsNull(value) ? Ok(BigInt(0)) : guard_exports.IsString(value) ? FromString2(value) : guard_exports.IsUndefined(value) ? Ok(BigInt(0)) : Fail();
}
var bigintPattern, decimalPattern, integerPattern;
var init_try_bigint = __esm({
  "node_modules/typebox/build/value/convert/try/try_bigint.mjs"() {
    init_guard2();
    init_try_result();
    bigintPattern = /^-?(0|[1-9]\d*)n$/;
    decimalPattern = /^-?(0|[1-9]\d*)\.\d+$/;
    integerPattern = /^-?(0|[1-9]\d*)$/;
  }
});

// node_modules/typebox/build/value/convert/try/try_boolean.mjs
function FromBigInt2(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(false) : guard_exports.IsEqual(value, BigInt(1)) ? Ok(true) : Fail();
}
function FromNumber2(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(false) : guard_exports.IsEqual(value, 1) ? Ok(true) : Fail();
}
function FromString3(value) {
  return guard_exports.IsEqual(value.toLowerCase(), "false") ? Ok(false) : guard_exports.IsEqual(value.toLowerCase(), "true") ? Ok(true) : guard_exports.IsEqual(value, "0") ? Ok(false) : guard_exports.IsEqual(value, "1") ? Ok(true) : Fail();
}
function TryBoolean(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt2(value) : guard_exports.IsBoolean(value) ? Ok(value) : guard_exports.IsNumber(value) ? FromNumber2(value) : guard_exports.IsNull(value) ? Ok(false) : guard_exports.IsString(value) ? FromString3(value) : guard_exports.IsUndefined(value) ? Ok(false) : Fail();
}
var init_try_boolean = __esm({
  "node_modules/typebox/build/value/convert/try/try_boolean.mjs"() {
    init_guard2();
    init_try_result();
  }
});

// node_modules/typebox/build/value/convert/try/try_null.mjs
function FromBigInt3(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(null) : Fail();
}
function FromBoolean3(value) {
  return guard_exports.IsEqual(value, false) ? Ok(null) : Fail();
}
function FromNumber3(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(null) : Fail();
}
function FromString4(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(null) : Fail();
}
function TryNull(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt3(value) : guard_exports.IsBoolean(value) ? FromBoolean3(value) : guard_exports.IsNumber(value) ? FromNumber3(value) : guard_exports.IsNull(value) ? Ok(null) : guard_exports.IsString(value) ? FromString4(value) : guard_exports.IsUndefined(value) ? Ok(null) : Fail();
}
var init_try_null = __esm({
  "node_modules/typebox/build/value/convert/try/try_null.mjs"() {
    init_guard2();
    init_try_result();
  }
});

// node_modules/typebox/build/value/convert/try/try_number.mjs
function FromBigInt4(value) {
  return value <= maxBigInt && value >= minBigInt ? Ok(Number(value)) : Fail();
}
function FromBoolean4(value) {
  return Ok(value ? 1 : 0);
}
function FromString5(value) {
  const coerced = +value;
  if (guard_exports.IsNumber(coerced))
    return Ok(coerced);
  const lowercase = value.toLowerCase();
  if (guard_exports.IsEqual(lowercase, "false"))
    return Ok(0);
  if (guard_exports.IsEqual(lowercase, "true"))
    return Ok(1);
  const result = TryBigInt(value);
  if (IsOk(result))
    return result.value <= maxBigInt && result.value >= minBigInt ? Ok(Number(result.value)) : Fail();
  return Fail();
}
function TryNumber(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt4(value) : guard_exports.IsBoolean(value) ? FromBoolean4(value) : guard_exports.IsNumber(value) ? Ok(value) : guard_exports.IsNull(value) ? Ok(0) : guard_exports.IsString(value) ? FromString5(value) : guard_exports.IsUndefined(value) ? Ok(0) : Fail();
}
var maxBigInt, minBigInt;
var init_try_number = __esm({
  "node_modules/typebox/build/value/convert/try/try_number.mjs"() {
    init_guard2();
    init_try_result();
    init_try_bigint();
    maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
    minBigInt = BigInt(Number.MIN_SAFE_INTEGER);
  }
});

// node_modules/typebox/build/value/convert/try/try_string.mjs
function TryString(value) {
  return guard_exports.IsBigInt(value) ? Ok(value.toString()) : guard_exports.IsBoolean(value) ? Ok(value.toString()) : guard_exports.IsNumber(value) ? Ok(value.toString()) : guard_exports.IsNull(value) ? Ok("null") : guard_exports.IsString(value) ? Ok(value) : guard_exports.IsUndefined(value) ? Ok("") : Fail();
}
var init_try_string = __esm({
  "node_modules/typebox/build/value/convert/try/try_string.mjs"() {
    init_guard2();
    init_try_result();
  }
});

// node_modules/typebox/build/value/convert/try/try_undefined.mjs
function FromBigInt5(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(void 0) : Fail();
}
function FromBoolean5(value) {
  return guard_exports.IsEqual(value, false) ? Ok(void 0) : Fail();
}
function FromNumber4(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(void 0) : Fail();
}
function FromString6(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(void 0) : Fail();
}
function TryUndefined(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt5(value) : guard_exports.IsBoolean(value) ? FromBoolean5(value) : guard_exports.IsNumber(value) ? FromNumber4(value) : guard_exports.IsNull(value) ? Ok(void 0) : guard_exports.IsString(value) ? FromString6(value) : guard_exports.IsUndefined(value) ? Ok(value) : Fail();
}
var init_try_undefined = __esm({
  "node_modules/typebox/build/value/convert/try/try_undefined.mjs"() {
    init_guard2();
    init_try_result();
  }
});

// node_modules/typebox/build/value/convert/try/try.mjs
var try_exports = {};
__export(try_exports, {
  Fail: () => Fail,
  IsOk: () => IsOk,
  Ok: () => Ok,
  TryArray: () => TryArray,
  TryBigInt: () => TryBigInt,
  TryBoolean: () => TryBoolean,
  TryNull: () => TryNull,
  TryNumber: () => TryNumber,
  TryString: () => TryString,
  TryUndefined: () => TryUndefined
});
var init_try = __esm({
  "node_modules/typebox/build/value/convert/try/try.mjs"() {
    init_try_array();
    init_try_bigint();
    init_try_boolean();
    init_try_null();
    init_try_number();
    init_try_result();
    init_try_string();
    init_try_undefined();
  }
});

// node_modules/typebox/build/value/convert/try/index.mjs
var init_try2 = __esm({
  "node_modules/typebox/build/value/convert/try/index.mjs"() {
    init_try();
  }
});

// node_modules/typebox/build/value/convert/from_array.mjs
function FromArray8(context, type, value) {
  const result = try_exports.TryArray(value);
  return result.value.map((value2) => FromType21(context, type.items, value2));
}
var init_from_array5 = __esm({
  "node_modules/typebox/build/value/convert/from_array.mjs"() {
    init_from_type12();
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_bigint.mjs
function FromBigInt6(_context, _type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) ? result.value : value;
}
var init_from_bigint = __esm({
  "node_modules/typebox/build/value/convert/from_bigint.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_boolean.mjs
function FromBoolean6(_context, _type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) ? result.value : value;
}
var init_from_boolean = __esm({
  "node_modules/typebox/build/value/convert/from_boolean.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_cyclic.mjs
function FromCyclic7(context, type, value) {
  return FromType21({ ...context, ...type.$defs }, Ref(type.$ref), value);
}
var init_from_cyclic7 = __esm({
  "node_modules/typebox/build/value/convert/from_cyclic.mjs"() {
    init_type3();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/from_enum.mjs
function FromEnum3(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}
var init_from_enum2 = __esm({
  "node_modules/typebox/build/value/convert/from_enum.mjs"() {
    init_type3();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/from_integer.mjs
function FromInteger(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? Math.trunc(result.value) : value;
}
var init_from_integer = __esm({
  "node_modules/typebox/build/value/convert/from_integer.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_intersect.mjs
function FromIntersect7(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType21(context, evaluated, value);
}
var init_from_intersect7 = __esm({
  "node_modules/typebox/build/value/convert/from_intersect.mjs"() {
    init_type3();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/from_literal.mjs
function FromLiteralBigInt(_context, type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralBoolean(_context, type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralNumber(_context, type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralString(_context, type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteral6(context, type, value) {
  if (guard_exports.IsEqual(type.const, value))
    return value;
  return IsLiteralBigInt(type) ? FromLiteralBigInt(context, type, value) : IsLiteralBoolean(type) ? FromLiteralBoolean(context, type, value) : IsLiteralNumber(type) ? FromLiteralNumber(context, type, value) : IsLiteralString(type) ? FromLiteralString(context, type, value) : Unreachable();
}
var init_from_literal3 = __esm({
  "node_modules/typebox/build/value/convert/from_literal.mjs"() {
    init_unreachable2();
    init_guard2();
    init_type3();
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_null.mjs
function FromNull2(_context, _type, value) {
  const result = try_exports.TryNull(value);
  return try_exports.IsOk(result) ? result.value : value;
}
var init_from_null = __esm({
  "node_modules/typebox/build/value/convert/from_null.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_number.mjs
function FromNumber5(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? result.value : value;
}
var init_from_number = __esm({
  "node_modules/typebox/build/value/convert/from_number.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_additional.mjs
function FromAdditionalProperties(context, entries, additionalProperties, value) {
  const keys = guard_exports.Keys(value);
  for (const [regexp, _] of entries) {
    for (const key of keys) {
      if (!regexp.test(key)) {
        value[key] = FromType21(context, additionalProperties, value[key]);
      }
    }
  }
  return value;
}
var init_from_additional = __esm({
  "node_modules/typebox/build/value/convert/from_additional.mjs"() {
    init_guard2();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/shared/optional_undefined.mjs
function IsOptionalUndefined(property, key, value) {
  return IsOptional(property) && guard_exports.IsUndefined(value[key]);
}
var init_optional_undefined = __esm({
  "node_modules/typebox/build/value/shared/optional_undefined.mjs"() {
    init_guard2();
    init_type3();
  }
});

// node_modules/typebox/build/value/convert/from_object.mjs
function FromProperties5(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.properties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, property] of entries) {
    for (const key of keys) {
      if (!regexp.test(key) || IsOptionalUndefined(property, key, value))
        continue;
      value[key] = FromType21(context, property, value[key]);
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromObject12(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromProperties5(context, type, value) : value;
}
var init_from_object8 = __esm({
  "node_modules/typebox/build/value/convert/from_object.mjs"() {
    init_guard2();
    init_from_type12();
    init_from_additional();
    init_optional_undefined();
  }
});

// node_modules/typebox/build/value/convert/from_record.mjs
function FromPatternProperties(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.patternProperties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, schema] of entries) {
    for (const key of keys) {
      if (regexp.test(key)) {
        value[key] = FromType21(context, schema, value[key]);
      }
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromRecord4(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromPatternProperties(context, type, value) : value;
}
var init_from_record3 = __esm({
  "node_modules/typebox/build/value/convert/from_record.mjs"() {
    init_guard2();
    init_from_type12();
    init_from_additional();
  }
});

// node_modules/typebox/build/value/convert/from_ref.mjs
function FromRef6(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType21(context, context[type.$ref], value) : value;
}
var init_from_ref2 = __esm({
  "node_modules/typebox/build/value/convert/from_ref.mjs"() {
    init_from_type12();
    init_guard2();
  }
});

// node_modules/typebox/build/value/convert/from_string.mjs
function FromString7(_context, _type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) ? result.value : value;
}
var init_from_string = __esm({
  "node_modules/typebox/build/value/convert/from_string.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_template_literal.mjs
function FromTemplateLiteral4(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}
var init_from_template_literal3 = __esm({
  "node_modules/typebox/build/value/convert/from_template_literal.mjs"() {
    init_type3();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/from_tuple.mjs
function FromTuple6(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let index = 0; index < Math.min(type.items.length, value.length); index++) {
    value[index] = FromType21(context, type.items[index], value[index]);
  }
  return value;
}
var init_from_tuple6 = __esm({
  "node_modules/typebox/build/value/convert/from_tuple.mjs"() {
    init_guard2();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/from_undefined.mjs
function FromUndefined2(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? result.value : value;
}
var init_from_undefined = __esm({
  "node_modules/typebox/build/value/convert/from_undefined.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_union.mjs
function FromUnion10(context, type, value) {
  const matched = type.anyOf.some((type2) => Check2(context, type2, value));
  if (matched)
    return value;
  const candidates = type.anyOf.map((type2) => FromType21(context, type2, Clone2(value)));
  const selected = candidates.find((value2) => Check2(context, type, value2));
  return guard_exports.IsUndefined(selected) ? value : selected;
}
var init_from_union8 = __esm({
  "node_modules/typebox/build/value/convert/from_union.mjs"() {
    init_guard2();
    init_check4();
    init_clone3();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/from_void.mjs
function FromVoid(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? void 0 : value;
}
var init_from_void = __esm({
  "node_modules/typebox/build/value/convert/from_void.mjs"() {
    init_try2();
  }
});

// node_modules/typebox/build/value/convert/from_type.mjs
function FromType21(context, type, value) {
  return IsArray2(type) ? FromArray8(context, type, value) : IsBigInt2(type) ? FromBigInt6(context, type, value) : IsBoolean3(type) ? FromBoolean6(context, type, value) : IsCyclic(type) ? FromCyclic7(context, type, value) : IsEnum(type) ? FromEnum3(context, type, value) : IsInteger2(type) ? FromInteger(context, type, value) : IsIntersect(type) ? FromIntersect7(context, type, value) : IsLiteral(type) ? FromLiteral6(context, type, value) : IsNull2(type) ? FromNull2(context, type, value) : IsNumber3(type) ? FromNumber5(context, type, value) : IsObject2(type) ? FromObject12(context, type, value) : IsRecord(type) ? FromRecord4(context, type, value) : IsRef(type) ? FromRef6(context, type, value) : IsString3(type) ? FromString7(context, type, value) : IsTemplateLiteral(type) ? FromTemplateLiteral4(context, type, value) : IsTuple(type) ? FromTuple6(context, type, value) : IsUndefined2(type) ? FromUndefined2(context, type, value) : IsUnion(type) ? FromUnion10(context, type, value) : IsVoid(type) ? FromVoid(context, type, value) : value;
}
var init_from_type12 = __esm({
  "node_modules/typebox/build/value/convert/from_type.mjs"() {
    init_type3();
    init_from_array5();
    init_from_bigint();
    init_from_boolean();
    init_from_cyclic7();
    init_from_enum2();
    init_from_integer();
    init_from_intersect7();
    init_from_literal3();
    init_from_null();
    init_from_number();
    init_from_object8();
    init_from_record3();
    init_from_ref2();
    init_from_string();
    init_from_template_literal3();
    init_from_tuple6();
    init_from_undefined();
    init_from_union8();
    init_from_void();
  }
});

// node_modules/typebox/build/value/convert/convert.mjs
function Convert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType21(context, type, value);
}
var init_convert = __esm({
  "node_modules/typebox/build/value/convert/convert.mjs"() {
    init_arguments2();
    init_from_type12();
  }
});

// node_modules/typebox/build/value/convert/index.mjs
var init_convert2 = __esm({
  "node_modules/typebox/build/value/convert/index.mjs"() {
    init_convert();
  }
});

// node_modules/typebox/build/value/default/from_array.mjs
function FromArray9(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType22(context, type.items, value[i]);
  }
  return value;
}
var init_from_array6 = __esm({
  "node_modules/typebox/build/value/default/from_array.mjs"() {
    init_guard2();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_cyclic.mjs
function FromCyclic8(context, type, value) {
  return FromType22({ ...context, ...type.$defs }, Ref(type.$ref), value);
}
var init_from_cyclic8 = __esm({
  "node_modules/typebox/build/value/default/from_cyclic.mjs"() {
    init_type3();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_default.mjs
function FromDefault(type, value) {
  if (!guard_exports.IsUndefined(value))
    return value;
  return guard_exports.IsFunction(type.default) ? type.default() : Clone2(type.default);
}
var init_from_default = __esm({
  "node_modules/typebox/build/value/default/from_default.mjs"() {
    init_guard2();
    init_clone3();
  }
});

// node_modules/typebox/build/value/default/from_intersect.mjs
function FromIntersect8(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType22(context, evaluated, value);
}
var init_from_intersect8 = __esm({
  "node_modules/typebox/build/value/default/from_intersect.mjs"() {
    init_type3();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_object.mjs
function FromObject13(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const knownPropertyKeys = guard_exports.Keys(type.properties);
  for (const key of knownPropertyKeys) {
    const propertyValue = FromType22(context, type.properties[key], value[key]);
    const isUnassignableUndefined = guard_exports.IsUndefined(propertyValue) && (IsOptional(type.properties[key]) || !guard_exports.HasPropertyKey(type.properties[key], "default"));
    if (isUnassignableUndefined)
      continue;
    value[key] = propertyValue;
  }
  if (!IsAdditionalProperties(type) || guard_exports.IsBoolean(type.additionalProperties))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (knownPropertyKeys.includes(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}
var init_from_object9 = __esm({
  "node_modules/typebox/build/value/default/from_object.mjs"() {
    init_type3();
    init_guard2();
    init_from_type13();
    init_types2();
  }
});

// node_modules/typebox/build/value/default/from_record.mjs
function FromRecord5(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const [recordKey, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (!(recordKey.test(key) && IsDefault(recordValue)))
      continue;
    value[key] = FromType22(context, recordValue, value[key]);
  }
  if (!IsAdditionalProperties(type))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (recordKey.test(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}
var init_from_record4 = __esm({
  "node_modules/typebox/build/value/default/from_record.mjs"() {
    init_type3();
    init_types2();
    init_guard2();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_ref.mjs
function FromRef7(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType22(context, context[type.$ref], value) : value;
}
var init_from_ref3 = __esm({
  "node_modules/typebox/build/value/default/from_ref.mjs"() {
    init_guard2();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_tuple.mjs
function FromTuple7(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const [items, max] = [schema.items, Math.max(schema.items.length, value.length)];
  for (let i = 0; i < max; i++) {
    if (i < items.length)
      value[i] = FromType22(context, items[i], value[i]);
  }
  return value;
}
var init_from_tuple7 = __esm({
  "node_modules/typebox/build/value/default/from_tuple.mjs"() {
    init_guard2();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_union.mjs
function FromUnion11(context, schema, value) {
  for (const inner of schema.anyOf) {
    const result = FromType22(context, inner, Clone2(value));
    if (Check2(context, inner, result)) {
      return result;
    }
  }
  return value;
}
var init_from_union9 = __esm({
  "node_modules/typebox/build/value/default/from_union.mjs"() {
    init_check4();
    init_clone3();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/from_type.mjs
function FromType22(context, type, value) {
  const defaulted = IsDefault(type) ? FromDefault(type, value) : value;
  return IsArray2(type) ? FromArray9(context, type, defaulted) : IsCyclic(type) ? FromCyclic8(context, type, defaulted) : IsIntersect(type) ? FromIntersect8(context, type, defaulted) : IsObject2(type) ? FromObject13(context, type, defaulted) : IsRecord(type) ? FromRecord5(context, type, defaulted) : IsRef(type) ? FromRef7(context, type, defaulted) : IsTuple(type) ? FromTuple7(context, type, defaulted) : IsUnion(type) ? FromUnion11(context, type, defaulted) : defaulted;
}
var init_from_type13 = __esm({
  "node_modules/typebox/build/value/default/from_type.mjs"() {
    init_schema5();
    init_type3();
    init_from_array6();
    init_from_cyclic8();
    init_from_default();
    init_from_intersect8();
    init_from_object9();
    init_from_record4();
    init_from_ref3();
    init_from_tuple7();
    init_from_union9();
  }
});

// node_modules/typebox/build/value/default/default.mjs
function Default(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType22(context, type, value);
}
var init_default2 = __esm({
  "node_modules/typebox/build/value/default/default.mjs"() {
    init_arguments2();
    init_from_type13();
  }
});

// node_modules/typebox/build/value/default/index.mjs
var init_default3 = __esm({
  "node_modules/typebox/build/value/default/index.mjs"() {
    init_default2();
  }
});

// node_modules/typebox/build/value/pipeline/pipeline.mjs
function Pipeline(pipeline) {
  return (...args) => {
    const [context, type, value] = arguments_exports.Match(args, {
      3: (context2, type2, value2) => [context2, type2, value2],
      2: (type2, value2) => [{}, type2, value2]
    });
    return pipeline.reduce((result, func) => func(context, type, result), value);
  };
}
var init_pipeline = __esm({
  "node_modules/typebox/build/value/pipeline/pipeline.mjs"() {
    init_arguments2();
  }
});

// node_modules/typebox/build/value/pipeline/index.mjs
var init_pipeline2 = __esm({
  "node_modules/typebox/build/value/pipeline/index.mjs"() {
    init_pipeline();
  }
});

// node_modules/typebox/build/value/codec/callback.mjs
function Decode3(_context, type, value) {
  return type["~codec"].decode(value);
}
function Encode2(_context, type, value) {
  return type["~codec"].encode(value);
}
function Callback(direction, context, type, value) {
  if (!IsCodec(type))
    return value;
  return guard_exports.IsEqual(direction, "Decode") ? Decode3(context, type, value) : Encode2(context, type, value);
}
var init_callback = __esm({
  "node_modules/typebox/build/value/codec/callback.mjs"() {
    init_guard2();
    init_type3();
  }
});

// node_modules/typebox/build/value/codec/from_array.mjs
function Decode4(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType23(direction, context, type.items, value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode3(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return exterior;
  for (let i = 0; i < exterior.length; i++) {
    exterior[i] = FromType23(direction, context, type.items, exterior[i]);
  }
  return exterior;
}
function FromArray10(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode4(direction, context, type, value) : Encode3(direction, context, type, value);
}
var init_from_array7 = __esm({
  "node_modules/typebox/build/value/codec/from_array.mjs"() {
    init_guard2();
    init_from_type14();
    init_callback();
  }
});

// node_modules/typebox/build/value/codec/from_cyclic.mjs
function FromCyclic9(direction, context, type, value) {
  value = FromType23(direction, { ...context, ...type.$defs }, Ref(type.$ref), value);
  return Callback(direction, context, type, value);
}
var init_from_cyclic9 = __esm({
  "node_modules/typebox/build/value/codec/from_cyclic.mjs"() {
    init_type3();
    init_from_type14();
    init_callback();
  }
});

// node_modules/typebox/build/value/codec/from_intersect.mjs
function MergeInteriors(interiors) {
  return interiors.reduce((results, interior) => ({ ...results, ...interior }), {});
}
function NonMatchingInterior(value, interiors) {
  for (const interior of interiors)
    if (!guard_exports.IsDeepEqual(value, interior))
      return interior;
  return value;
}
function Decode5(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(value))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  const exterior = structural ? MergeInteriors(interiors) : NonMatchingInterior(value, interiors);
  return Callback(direction, context, type, exterior);
}
function Encode4(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const exterior = Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(exterior))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  if (structural)
    return MergeInteriors(interiors);
  return NonMatchingInterior(exterior, interiors);
}
function FromIntersect9(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode5(direction, context, type, value) : Encode4(direction, context, type, value);
}
var init_from_intersect9 = __esm({
  "node_modules/typebox/build/value/codec/from_intersect.mjs"() {
    init_guard2();
    init_from_type14();
    init_callback();
    init_clone3();
    init_clean2();
  }
});

// node_modules/typebox/build/value/codec/from_object.mjs
function Decode6(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(value, key) || IsOptionalUndefined(type.properties[key], key, value))
      continue;
    value[key] = FromType23(direction, context, type.properties[key], value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode5(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(exterior, key) || IsOptionalUndefined(type.properties[key], key, exterior))
      continue;
    exterior[key] = FromType23(direction, context, type.properties[key], exterior[key]);
  }
  return exterior;
}
function FromObject14(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode6(direction, context, type, value) : Encode5(direction, context, type, value);
}
var init_from_object10 = __esm({
  "node_modules/typebox/build/value/codec/from_object.mjs"() {
    init_guard2();
    init_from_type14();
    init_callback();
    init_optional_undefined();
  }
});

// node_modules/typebox/build/value/codec/from_record.mjs
function Decode7(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(value)) {
    if (!regexp.test(key))
      continue;
    value[key] = FromType23(direction, context, RecordValue(type), value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode6(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(exterior)) {
    if (!regexp.test(key))
      continue;
    exterior[key] = FromType23(direction, context, RecordValue(type), exterior[key]);
  }
  return exterior;
}
function FromRecord6(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode7(direction, context, type, value) : Encode6(direction, context, type, value);
}
var init_from_record5 = __esm({
  "node_modules/typebox/build/value/codec/from_record.mjs"() {
    init_guard2();
    init_type3();
    init_from_type14();
    init_callback();
  }
});

// node_modules/typebox/build/value/codec/from_ref.mjs
function ResolveRef(direction, context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType23(direction, context, context[type.$ref], value) : value;
}
function FromRef8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Callback(direction, context, type, ResolveRef(direction, context, type, value)) : ResolveRef(direction, context, type, Callback(direction, context, type, value));
}
var init_from_ref4 = __esm({
  "node_modules/typebox/build/value/codec/from_ref.mjs"() {
    init_guard2();
    init_from_type14();
    init_callback();
  }
});

// node_modules/typebox/build/value/codec/from_tuple.mjs
function Decode8(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < Math.min(type.items.length, value.length); i++) {
    value[i] = FromType23(direction, context, type.items[i], value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode7(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return value;
  for (let i = 0; i < Math.min(type.items.length, exterior.length); i++) {
    exterior[i] = FromType23(direction, context, type.items[i], exterior[i]);
  }
  return exterior;
}
function FromTuple8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode8(direction, context, type, value) : Encode7(direction, context, type, value);
}
var init_from_tuple8 = __esm({
  "node_modules/typebox/build/value/codec/from_tuple.mjs"() {
    init_guard2();
    init_from_type14();
    init_callback();
  }
});

// node_modules/typebox/build/value/codec/from_union.mjs
function Decode9(direction, context, type, value) {
  for (const schema of type.anyOf) {
    if (!Check2(context, schema, value))
      continue;
    const variant = FromType23(direction, context, schema, value);
    return Callback(direction, context, type, variant);
  }
  return value;
}
function Encode8(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  for (const schema of type.anyOf) {
    const variant = FromType23(direction, context, schema, Clone2(exterior));
    if (!Check2(context, schema, variant))
      continue;
    return variant;
  }
  return exterior;
}
function FromUnion12(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode9(direction, context, type, value) : Encode8(direction, context, type, value);
}
var init_from_union10 = __esm({
  "node_modules/typebox/build/value/codec/from_union.mjs"() {
    init_guard2();
    init_callback();
    init_from_type14();
    init_clone3();
    init_check4();
  }
});

// node_modules/typebox/build/value/codec/from_type.mjs
function FromType23(direction, context, type, value) {
  return IsArray2(type) ? FromArray10(direction, context, type, value) : IsCyclic(type) ? FromCyclic9(direction, context, type, value) : IsIntersect(type) ? FromIntersect9(direction, context, type, value) : IsObject2(type) ? FromObject14(direction, context, type, value) : IsRecord(type) ? FromRecord6(direction, context, type, value) : IsRef(type) ? FromRef8(direction, context, type, value) : IsTuple(type) ? FromTuple8(direction, context, type, value) : IsUnion(type) ? FromUnion12(direction, context, type, value) : Callback(direction, context, type, value);
}
var init_from_type14 = __esm({
  "node_modules/typebox/build/value/codec/from_type.mjs"() {
    init_type3();
    init_from_array7();
    init_from_cyclic9();
    init_from_intersect9();
    init_from_object10();
    init_from_record5();
    init_from_ref4();
    init_from_tuple8();
    init_from_union10();
    init_callback();
  }
});

// node_modules/typebox/build/value/codec/decode.mjs
function Assert2(context, type, value) {
  if (!Check2(context, type, value))
    throw new DecodeError(value, Errors2(context, type, value));
  return value;
}
function DecodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Decode", context, sorted, value);
}
function Decode10(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Decoder(context, type, value);
}
var DecodeError, Decoder;
var init_decode2 = __esm({
  "node_modules/typebox/build/value/codec/decode.mjs"() {
    init_system2();
    init_assert2();
    init_check4();
    init_errors3();
    init_clean2();
    init_clone3();
    init_convert2();
    init_default3();
    init_pipeline2();
    init_from_type14();
    init_union_priority_sort();
    DecodeError = class extends AssertError {
      constructor(value, errors) {
        super("Decode", value, errors);
      }
    };
    Decoder = Pipeline([
      (_context, _type, value) => Clone2(value),
      (context, type, value) => Default(context, type, value),
      (context, type, value) => Convert(context, type, value),
      (context, type, value) => Clean(context, type, value),
      (context, type, value) => Assert2(context, type, value),
      (context, type, value) => DecodeUnsafe(context, type, value)
    ]);
  }
});

// node_modules/typebox/build/value/codec/encode.mjs
function Assert3(context, type, value) {
  if (!Check2(context, type, value))
    throw new EncodeError(value, Errors2(context, type, value));
  return value;
}
function EncodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Encode", context, sorted, value);
}
function Encode9(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Encoder(context, type, value);
}
var EncodeError, Encoder;
var init_encode2 = __esm({
  "node_modules/typebox/build/value/codec/encode.mjs"() {
    init_system2();
    init_assert2();
    init_check4();
    init_errors3();
    init_clean2();
    init_clone3();
    init_convert2();
    init_default3();
    init_pipeline2();
    init_from_type14();
    init_union_priority_sort();
    EncodeError = class extends AssertError {
      constructor(value, errors) {
        super("Encode", value, errors);
      }
    };
    Encoder = Pipeline([
      (_context, _type, value) => Clone2(value),
      (context, type, value) => EncodeUnsafe(context, type, value),
      (context, type, value) => Default(context, type, value),
      (context, type, value) => Convert(context, type, value),
      (context, type, value) => Clean(context, type, value),
      (context, type, value) => Assert3(context, type, value)
    ]);
  }
});

// node_modules/typebox/build/value/codec/has.mjs
function FromArray11(context, type) {
  return IsCodec(type) || FromType24(context, type.items);
}
function FromCyclic10(context, type) {
  return IsCodec(type) || FromRef9({ ...context, ...type.$defs }, Ref(type.$ref));
}
function FromIntersect10(context, type) {
  return IsCodec(type) || type.allOf.some((type2) => FromType24(context, type2));
}
function FromObject15(context, type) {
  return IsCodec(type) || guard_exports.Keys(type.properties).some((key) => {
    return FromType24(context, type.properties[key]);
  });
}
function FromRecord7(context, type) {
  return IsCodec(type) || FromType24(context, RecordValue(type));
}
function FromRef9(context, type) {
  if (visited.has(type.$ref))
    return false;
  visited.add(type.$ref);
  return IsCodec(type) || guard_exports.HasPropertyKey(context, type.$ref) && FromType24(context, context[type.$ref]);
}
function FromTuple9(context, type) {
  return IsCodec(type) || type.items.some((type2) => FromType24(context, type2));
}
function FromUnion13(context, type) {
  return IsCodec(type) || type.anyOf.some((type2) => FromType24(context, type2));
}
function FromType24(context, type) {
  return IsArray2(type) ? FromArray11(context, type) : IsCyclic(type) ? FromCyclic10(context, type) : IsIntersect(type) ? FromIntersect10(context, type) : IsObject2(type) ? FromObject15(context, type) : IsRecord(type) ? FromRecord7(context, type) : IsRef(type) ? FromRef9(context, type) : IsTuple(type) ? FromTuple9(context, type) : IsUnion(type) ? FromUnion13(context, type) : IsCodec(type);
}
function HasCodec(...args) {
  const [context, type] = arguments_exports.Match(args, {
    2: (context2, type2) => [context2, type2],
    1: (type2) => [{}, type2]
  });
  visited.clear();
  return FromType24(context, type);
}
var visited;
var init_has = __esm({
  "node_modules/typebox/build/value/codec/has.mjs"() {
    init_arguments2();
    init_guard2();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    init_type3();
    visited = /* @__PURE__ */ new Set();
  }
});

// node_modules/typebox/build/value/codec/index.mjs
var init_codec2 = __esm({
  "node_modules/typebox/build/value/codec/index.mjs"() {
    init_decode2();
    init_encode2();
    init_has();
  }
});

// node_modules/typebox/build/value/create/error.mjs
var CreateError;
var init_error = __esm({
  "node_modules/typebox/build/value/create/error.mjs"() {
    CreateError = class extends Error {
      constructor(type, message) {
        super(message);
        this.type = type;
      }
    };
  }
});

// node_modules/typebox/build/value/create/from_default.mjs
function FromDefault2(_context, schema) {
  return guard_exports.IsFunction(schema.default) ? schema.default(schema) : guard_exports.IsObject(schema.default) ? Clone2(schema.default) : schema.default;
}
var init_from_default2 = __esm({
  "node_modules/typebox/build/value/create/from_default.mjs"() {
    init_guard2();
    init_clone3();
  }
});

// node_modules/typebox/build/value/create/from_array.mjs
function FromArray12(context, type) {
  if (IsUniqueItems(type) && !IsDefault(type))
    throw new CreateError(type, "Arrays with uniqueItems constraints must specify a default annotation");
  const length = IsMinItems(type) ? type.minItems : 0;
  return Array.from({ length }, () => FromType25(context, type.items));
}
var init_from_array8 = __esm({
  "node_modules/typebox/build/value/create/from_array.mjs"() {
    init_types2();
    init_from_type15();
    init_error();
  }
});

// node_modules/typebox/build/value/create/from_bigint.mjs
function FromBigInt7(_context, type) {
  return IsExclusiveMinimum(type) ? BigInt(type.exclusiveMinimum) + BigInt(1) : IsMinimum(type) ? BigInt(type.minimum) : BigInt(0);
}
var init_from_bigint2 = __esm({
  "node_modules/typebox/build/value/create/from_bigint.mjs"() {
    init_types2();
  }
});

// node_modules/typebox/build/value/create/from_boolean.mjs
function FromBoolean7(_context, _type) {
  return false;
}
var init_from_boolean2 = __esm({
  "node_modules/typebox/build/value/create/from_boolean.mjs"() {
  }
});

// node_modules/typebox/build/value/create/from_constructor.mjs
function FromConstructor2(context, type) {
  const instanceType = FromType25(context, type.instanceType);
  return class {
    constructor() {
      Object.assign(this, instanceType);
    }
  };
}
var init_from_constructor = __esm({
  "node_modules/typebox/build/value/create/from_constructor.mjs"() {
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_cyclic.mjs
function FromCyclic11(context, type) {
  return FromType25({ ...context, ...type.$defs }, Ref(type.$ref));
}
var init_from_cyclic10 = __esm({
  "node_modules/typebox/build/value/create/from_cyclic.mjs"() {
    init_type3();
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_enum.mjs
function FromEnum4(context, type) {
  return FromType25(context, Evaluate(type));
}
var init_from_enum3 = __esm({
  "node_modules/typebox/build/value/create/from_enum.mjs"() {
    init_type3();
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_function.mjs
function FromFunction2(context, type) {
  const returnType = FromType25(context, type.returnType);
  return () => returnType;
}
var init_from_function = __esm({
  "node_modules/typebox/build/value/create/from_function.mjs"() {
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_integer.mjs
function FromInteger2(_context, type) {
  return IsExclusiveMinimum(type) && guard_exports.IsNumber(type.exclusiveMinimum) ? type.exclusiveMinimum + 1 : IsMinimum(type) ? type.minimum : 0;
}
var init_from_integer2 = __esm({
  "node_modules/typebox/build/value/create/from_integer.mjs"() {
    init_guard2();
    init_types2();
  }
});

// node_modules/typebox/build/value/create/from_intersect.mjs
function FromIntersect11(context, type) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType25(context, evaluated);
}
var init_from_intersect10 = __esm({
  "node_modules/typebox/build/value/create/from_intersect.mjs"() {
    init_type3();
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_literal.mjs
function FromLiteral7(_context, type) {
  return type.const;
}
var init_from_literal4 = __esm({
  "node_modules/typebox/build/value/create/from_literal.mjs"() {
  }
});

// node_modules/typebox/build/value/create/from_never.mjs
function FromNever(_context, type) {
  throw new CreateError(type, "Cannot create TNever types");
}
var init_from_never = __esm({
  "node_modules/typebox/build/value/create/from_never.mjs"() {
    init_error();
  }
});

// node_modules/typebox/build/value/create/from_null.mjs
function FromNull3(_context, _type) {
  return null;
}
var init_from_null2 = __esm({
  "node_modules/typebox/build/value/create/from_null.mjs"() {
  }
});

// node_modules/typebox/build/value/create/from_number.mjs
function FromNumber6(_context, type) {
  return IsExclusiveMinimum(type) && guard_exports.IsNumber(type.exclusiveMinimum) ? type.exclusiveMinimum + 1 : IsMinimum(type) ? type.minimum : 0;
}
var init_from_number2 = __esm({
  "node_modules/typebox/build/value/create/from_number.mjs"() {
    init_guard2();
    init_types2();
  }
});

// node_modules/typebox/build/value/create/from_object.mjs
function FromObject16(context, type) {
  const required = guard_exports.IsUndefined(type.required) ? [] : type.required;
  return required.reduce((result, key) => {
    return { ...result, [key]: FromType25(context, type.properties[key]) };
  }, {});
}
var init_from_object11 = __esm({
  "node_modules/typebox/build/value/create/from_object.mjs"() {
    init_guard2();
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_record.mjs
function FromRecord8(_context, type) {
  if (IsMinProperties(type) && !IsDefault(type))
    throw new CreateError(type, "Record with the minProperties constraint must have a default annotation");
  return {};
}
var init_from_record6 = __esm({
  "node_modules/typebox/build/value/create/from_record.mjs"() {
    init_types2();
    init_error();
  }
});

// node_modules/typebox/build/value/create/from_ref.mjs
function FromRef10(context, type) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType25(context, context[type.$ref]) : (() => {
    throw new CreateError(type, "Unable to deref Ref");
  })();
}
var init_from_ref5 = __esm({
  "node_modules/typebox/build/value/create/from_ref.mjs"() {
    init_guard2();
    init_from_type15();
    init_error();
  }
});

// node_modules/typebox/build/value/create/from_string.mjs
function FromString8(_context, type) {
  const needsDefault = (IsPattern(type) || IsFormat(type)) && !IsDefault(type);
  if (needsDefault)
    throw Error("Strings with format or pattern constraints must specify default");
  const minLength = IsMinLength3(type) ? type.minLength : 0;
  return "".padEnd(minLength);
}
var init_from_string2 = __esm({
  "node_modules/typebox/build/value/create/from_string.mjs"() {
    init_types2();
  }
});

// node_modules/typebox/build/value/create/from_symbol.mjs
function FromSymbol2(_context, _type) {
  return /* @__PURE__ */ Symbol();
}
var init_from_symbol = __esm({
  "node_modules/typebox/build/value/create/from_symbol.mjs"() {
  }
});

// node_modules/typebox/build/value/create/from_template_literal.mjs
function FromTemplateLiteral5(context, type) {
  const decoded = TemplateLiteralDecode(type.pattern);
  if (IsString3(decoded))
    throw new CreateError(type, "Unable to create TemplateLiteral due to infinite type expansion");
  return FromType25(context, decoded);
}
var init_from_template_literal4 = __esm({
  "node_modules/typebox/build/value/create/from_template_literal.mjs"() {
    init_type3();
    init_template_literal3();
    init_from_type15();
    init_error();
  }
});

// node_modules/typebox/build/value/create/from_tuple.mjs
function FromTuple10(context, type) {
  return Array.from({ length: type.minItems }, (_, i) => FromType25(context, type.items[i]));
}
var init_from_tuple9 = __esm({
  "node_modules/typebox/build/value/create/from_tuple.mjs"() {
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_undefined.mjs
function FromUndefined3(_context, _type) {
  return void 0;
}
var init_from_undefined2 = __esm({
  "node_modules/typebox/build/value/create/from_undefined.mjs"() {
  }
});

// node_modules/typebox/build/value/create/from_union.mjs
function FromUnion14(context, type) {
  if (guard_exports.IsEqual(type.anyOf.length, 0)) {
    throw Error("Unable to create Union with no variants");
  }
  return FromType25(context, type.anyOf[0]);
}
var init_from_union11 = __esm({
  "node_modules/typebox/build/value/create/from_union.mjs"() {
    init_guard2();
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/from_void.mjs
function FromVoid2(_context, _type) {
  return void 0;
}
var init_from_void2 = __esm({
  "node_modules/typebox/build/value/create/from_void.mjs"() {
  }
});

// node_modules/typebox/build/value/create/from_type.mjs
function FromType25(context, type) {
  return (
    // -----------------------------------------------------
    // Default
    // -----------------------------------------------------
    IsDefault(type) ? FromDefault2(context, type) : (
      // -----------------------------------------------------
      // Types
      // -----------------------------------------------------
      IsArray2(type) ? FromArray12(context, type) : IsBigInt2(type) ? FromBigInt7(context, type) : IsBoolean3(type) ? FromBoolean7(context, type) : IsConstructor2(type) ? FromConstructor2(context, type) : IsCyclic(type) ? FromCyclic11(context, type) : IsEnum(type) ? FromEnum4(context, type) : IsFunction2(type) ? FromFunction2(context, type) : IsInteger2(type) ? FromInteger2(context, type) : IsIntersect(type) ? FromIntersect11(context, type) : IsLiteral(type) ? FromLiteral7(context, type) : IsNever(type) ? FromNever(context, type) : IsNull2(type) ? FromNull3(context, type) : IsNumber3(type) ? FromNumber6(context, type) : IsObject2(type) ? FromObject16(context, type) : IsRecord(type) ? FromRecord8(context, type) : IsRef(type) ? FromRef10(context, type) : IsString3(type) ? FromString8(context, type) : IsSymbol2(type) ? FromSymbol2(context, type) : IsTemplateLiteral(type) ? FromTemplateLiteral5(context, type) : IsTuple(type) ? FromTuple10(context, type) : IsUndefined2(type) ? FromUndefined3(context, type) : IsUnion(type) ? FromUnion14(context, type) : IsVoid(type) ? FromVoid2(context, type) : void 0
    )
  );
}
var init_from_type15 = __esm({
  "node_modules/typebox/build/value/create/from_type.mjs"() {
    init_type3();
    init_types2();
    init_from_default2();
    init_from_array8();
    init_from_bigint2();
    init_from_boolean2();
    init_from_constructor();
    init_from_cyclic10();
    init_from_enum3();
    init_from_function();
    init_from_integer2();
    init_from_intersect10();
    init_from_literal4();
    init_from_never();
    init_from_null2();
    init_from_number2();
    init_from_object11();
    init_from_record6();
    init_from_ref5();
    init_from_string2();
    init_from_symbol();
    init_from_template_literal4();
    init_from_tuple9();
    init_from_undefined2();
    init_from_union11();
    init_from_void2();
  }
});

// node_modules/typebox/build/value/create/create.mjs
function Create2(...args) {
  const [context, type] = arguments_exports.Match(args, {
    2: (context2, type2) => [context2, type2],
    1: (type2) => [{}, type2]
  });
  return FromType25(context, type);
}
var init_create3 = __esm({
  "node_modules/typebox/build/value/create/create.mjs"() {
    init_arguments2();
    init_from_type15();
  }
});

// node_modules/typebox/build/value/create/index.mjs
var init_create4 = __esm({
  "node_modules/typebox/build/value/create/index.mjs"() {
    init_error();
    init_create3();
  }
});

// node_modules/typebox/build/value/equal/equal.mjs
function Equal(left, right) {
  return guard_exports.IsDeepEqual(left, right);
}
var init_equal = __esm({
  "node_modules/typebox/build/value/equal/equal.mjs"() {
    init_guard2();
  }
});

// node_modules/typebox/build/value/equal/index.mjs
var init_equal2 = __esm({
  "node_modules/typebox/build/value/equal/index.mjs"() {
    init_equal();
  }
});

// node_modules/typebox/build/value/hash/hash.mjs
function Hash2(value) {
  return hash_exports.Hash(value);
}
var init_hash2 = __esm({
  "node_modules/typebox/build/value/hash/hash.mjs"() {
    init_hashing();
  }
});

// node_modules/typebox/build/value/hash/index.mjs
var init_hash3 = __esm({
  "node_modules/typebox/build/value/hash/index.mjs"() {
    init_hash2();
  }
});

// node_modules/typebox/build/value/parse/parse.mjs
function Assert4(context, type, value) {
  if (!Check2(context, type, value))
    throw new ParseError2(value, Errors2(context, type, value));
  return value;
}
function Parse(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const checked = Check2(context, type, value);
  if (checked)
    return value;
  if (settings_exports.Get().correctiveParse)
    return Parser(context, type, value);
  throw new ParseError2(value, Errors2(context, type, value));
}
var ParseError2, Parser;
var init_parse2 = __esm({
  "node_modules/typebox/build/value/parse/parse.mjs"() {
    init_system();
    init_arguments2();
    init_assert2();
    init_check4();
    init_errors3();
    init_clean2();
    init_clone3();
    init_convert2();
    init_default3();
    init_pipeline2();
    ParseError2 = class extends AssertError {
      constructor(value, errors) {
        super("Parse", value, errors);
      }
    };
    Parser = Pipeline([
      (_context, _type, value) => Clone2(value),
      (context, type, value) => Default(context, type, value),
      (context, type, value) => Convert(context, type, value),
      (context, type, value) => Clean(context, type, value),
      (context, type, value) => Assert4(context, type, value)
    ]);
  }
});

// node_modules/typebox/build/value/parse/index.mjs
var init_parse3 = __esm({
  "node_modules/typebox/build/value/parse/index.mjs"() {
    init_parse2();
  }
});

// node_modules/typebox/build/value/delta/diff.mjs
function CreateUpdate(path14, value) {
  return { type: "update", path: path14, value };
}
function CreateInsert(path14, value) {
  return { type: "insert", path: path14, value };
}
function CreateDelete(path14) {
  return { type: "delete", path: path14 };
}
function AssertCanDiffObject(value) {
  if (guard_exports.IsObject(value) && guard_exports.IsEqual(guard_exports.Symbols(value).length, 0))
    return;
  throw new Error("Cannot create diffs for objects with symbols keys");
}
function* FromObject17(path14, left, right) {
  if (!guard_exports.IsObject(right) || guard_exports.IsArray(right))
    return yield CreateUpdate(path14, right);
  AssertCanDiffObject(left);
  AssertCanDiffObject(right);
  const leftKeys = guard_exports.Keys(left);
  const rightKeys = guard_exports.Keys(right);
  for (const key of rightKeys) {
    if (guard_exports.HasPropertyKey(left, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    yield CreateInsert(`${path14}/${key}`, right[key]);
  }
  for (const key of leftKeys) {
    if (!guard_exports.HasPropertyKey(right, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    if (Equal(left, right))
      continue;
    yield* FromValue4(`${path14}/${key}`, left[key], right[key]);
  }
  for (const key of leftKeys) {
    if (guard_exports.HasPropertyKey(right, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    yield CreateDelete(`${path14}/${key}`);
  }
}
function* FromArray13(path14, left, right) {
  if (!guard_exports.IsArray(right))
    return yield CreateUpdate(path14, right);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    yield* FromValue4(`${path14}/${i}`, left[i], right[i]);
  }
  for (let i = 0; i < right.length; i++) {
    if (i < left.length)
      continue;
    yield CreateInsert(`${path14}/${i}`, right[i]);
  }
  for (let i = left.length - 1; i >= 0; i--) {
    if (i < right.length)
      continue;
    yield CreateDelete(`${path14}/${i}`);
  }
}
function* FromTypedArray2(path14, left, right) {
  const typeLeft = globalThis.Object.getPrototypeOf(left).constructor.name;
  const typeRight = globalThis.Object.getPrototypeOf(right).constructor.name;
  const predicate = globals_exports.IsTypeArray(right) && guard_exports.IsEqual(left.length, right.length) && guard_exports.IsEqual(typeLeft, typeRight);
  if (predicate) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      yield* FromValue4(`${path14}/${index}`, left[index], right[index]);
    }
  } else {
    return yield CreateUpdate(path14, right);
  }
}
function* FromUnknown(path14, left, right) {
  if (left === right)
    return;
  yield CreateUpdate(path14, right);
}
function* FromValue4(path14, left, right) {
  return globals_exports.IsTypeArray(left) ? yield* FromTypedArray2(path14, left, right) : guard_exports.IsArray(left) ? yield* FromArray13(path14, left, right) : guard_exports.IsObject(left) ? yield* FromObject17(path14, left, right) : yield* FromUnknown(path14, left, right);
}
function Diff(current, next) {
  return [...FromValue4("", current, next)];
}
var init_diff = __esm({
  "node_modules/typebox/build/value/delta/diff.mjs"() {
    init_guard2();
    init_equal2();
  }
});

// node_modules/typebox/build/value/delta/edit.mjs
var Insert2, Update2, Delete2, Edit;
var init_edit = __esm({
  "node_modules/typebox/build/value/delta/edit.mjs"() {
    init_type3();
    Insert2 = _Object_({
      type: Literal("insert"),
      path: String2(),
      value: Unknown()
    });
    Update2 = Object({
      type: Literal("update"),
      path: String2(),
      value: Unknown()
    });
    Delete2 = _Object_({
      type: Literal("delete"),
      path: String2()
    });
    Edit = Union([Insert2, Update2, Delete2]);
  }
});

// node_modules/typebox/build/value/pointer/index.mjs
var init_pointer3 = __esm({
  "node_modules/typebox/build/value/pointer/index.mjs"() {
    init_pointer2();
  }
});

// node_modules/typebox/build/value/delta/patch.mjs
function IsRoot(edits) {
  return edits.length > 0 && edits[0].path === "" && edits[0].type === "update";
}
function IsEmpty(edits) {
  return edits.length === 0;
}
function Patch(current, edits) {
  if (IsRoot(edits))
    return Clone2(edits[0].value);
  if (IsEmpty(edits))
    return Clone2(current);
  const clone = Clone2(current);
  for (const edit of edits) {
    switch (edit.type) {
      case "insert": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "update": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "delete": {
        pointer_exports.Delete(clone, edit.path);
        break;
      }
    }
  }
  return clone;
}
var init_patch = __esm({
  "node_modules/typebox/build/value/delta/patch.mjs"() {
    init_clone3();
    init_pointer3();
  }
});

// node_modules/typebox/build/value/delta/index.mjs
var init_delta = __esm({
  "node_modules/typebox/build/value/delta/index.mjs"() {
    init_diff();
    init_edit();
    init_patch();
  }
});

// node_modules/typebox/build/value/repair/error.mjs
var RepairError;
var init_error2 = __esm({
  "node_modules/typebox/build/value/repair/error.mjs"() {
    RepairError = class extends Error {
      constructor(context, type, value, message) {
        super(message);
        this.context = context;
        this.type = type;
        this.value = value;
      }
    };
  }
});

// node_modules/typebox/build/value/repair/from_array.mjs
function MakeUnique(values) {
  const [hashes, result] = [/* @__PURE__ */ new Set(), []];
  for (const value of values) {
    const hash = Hash2(value);
    if (hashes.has(hash))
      continue;
    hashes.add(hash);
    result.push(value);
  }
  return result;
}
function FromArray14(context, type, value) {
  if (Check2(context, type, value))
    return value;
  const created = guard_exports.IsArray(value) ? value : Create2(context, type);
  const minimum = IsMinItems(type) && created.length < type.minItems ? [...created, ...Array.from({ length: type.minItems - created.length }, () => Create2(context, type))] : created;
  const maximum = IsMaxItems(type) && minimum.length > type.maxItems ? minimum.slice(0, type.maxItems) : minimum;
  const repaired = maximum.map((value2) => FromType26(context, type.items, value2));
  if (!IsUniqueItems(type) || IsUniqueItems(type) && !guard_exports.IsEqual(type.uniqueItems, true))
    return repaired;
  const unique = MakeUnique(repaired);
  if (!Check2(context, type, unique))
    throw new RepairError(context, type, value, "Failed to repair Array due to uniqueItems constraint");
  return unique;
}
var init_from_array9 = __esm({
  "node_modules/typebox/build/value/repair/from_array.mjs"() {
    init_types2();
    init_guard2();
    init_check4();
    init_create4();
    init_hash3();
    init_from_type16();
    init_error2();
  }
});

// node_modules/typebox/build/value/repair/from_enum.mjs
function FromEnum5(context, type, value) {
  return FromType26(context, Evaluate(type), value);
}
var init_from_enum4 = __esm({
  "node_modules/typebox/build/value/repair/from_enum.mjs"() {
    init_type3();
    init_from_type16();
  }
});

// node_modules/typebox/build/value/repair/from_intersect.mjs
function FromIntersect12(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType26(context, evaluated, value);
}
var init_from_intersect11 = __esm({
  "node_modules/typebox/build/value/repair/from_intersect.mjs"() {
    init_type3();
    init_from_type16();
  }
});

// node_modules/typebox/build/value/repair/from_object.mjs
function FromObject18(context, type, value) {
  if (Check2(context, type, value))
    return value;
  if (!guard_exports.IsObjectNotArray(value))
    return Create2(context, type);
  const required = new Set(guard_exports.IsUndefined(type.required) ? [] : type.required);
  const result = {};
  for (const [key, schema] of guard_exports.Entries(type.properties)) {
    if (!required.has(key) && guard_exports.IsUndefined(value[key]))
      continue;
    result[key] = key in value ? FromType26(context, schema, value[key]) : Create2(context, schema);
  }
  const evaluatedKeys = guard_exports.Keys(type.properties);
  if (IsAdditionalProperties(type) && guard_exports.IsObject(type.additionalProperties)) {
    for (const key of guard_exports.Keys(value)) {
      if (evaluatedKeys.includes(key))
        continue;
      result[key] = FromType26(context, type.additionalProperties, value[key]);
    }
  }
  return result;
}
var init_from_object12 = __esm({
  "node_modules/typebox/build/value/repair/from_object.mjs"() {
    init_guard2();
    init_check4();
    init_create4();
    init_types2();
    init_from_type16();
  }
});

// node_modules/typebox/build/value/repair/from_record.mjs
function FromRecord9(context, type, value) {
  if (Check2(context, type, value))
    return value;
  if (guard_exports.IsNull(value) || !guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return Create2(context, type);
  const recordKey = new RegExp(RecordPattern(type));
  const recordValue = RecordValue(type);
  const evaluatedKeys = /* @__PURE__ */ new Set();
  const result = {};
  for (const [key, value_] of guard_exports.Entries(value)) {
    if (!recordKey.test(key))
      continue;
    result[key] = FromType26(context, recordValue, value_);
    evaluatedKeys.add(key);
  }
  if (IsAdditionalProperties(type)) {
    for (const key of guard_exports.Keys(value)) {
      if (evaluatedKeys.has(key))
        continue;
      result[key] = FromType26(context, type.additionalProperties, value[key]);
    }
  }
  return result;
}
var init_from_record7 = __esm({
  "node_modules/typebox/build/value/repair/from_record.mjs"() {
    init_types2();
    init_type3();
    init_guard2();
    init_create4();
    init_check4();
    init_from_type16();
  }
});

// node_modules/typebox/build/value/repair/from_ref.mjs
function FromRef11(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType26(context, context[type.$ref], value) : (() => {
    throw new RepairError(context, type, value, "Unable to de-reference target type");
  })();
}
var init_from_ref6 = __esm({
  "node_modules/typebox/build/value/repair/from_ref.mjs"() {
    init_guard2();
    init_from_type16();
    init_error2();
  }
});

// node_modules/typebox/build/value/repair/from_template_literal.mjs
function FromTemplateLiteral6(context, type, value) {
  const decoded = TemplateLiteralDecode(type.pattern);
  return FromType26(context, decoded, value);
}
var init_from_template_literal5 = __esm({
  "node_modules/typebox/build/value/repair/from_template_literal.mjs"() {
    init_template_literal3();
    init_from_type16();
  }
});

// node_modules/typebox/build/value/repair/from_tuple.mjs
function FromTuple11(context, schema, value) {
  if (Check2(context, schema, value))
    return value;
  if (!guard_exports.IsArray(value))
    return Create2(context, schema);
  return schema.items.map((schema2, index) => FromType26(context, schema2, value[index]));
}
var init_from_tuple10 = __esm({
  "node_modules/typebox/build/value/repair/from_tuple.mjs"() {
    init_guard2();
    init_check4();
    init_create4();
    init_from_type16();
  }
});

// node_modules/typebox/build/value/shared/union_score_select.mjs
function Deref(context, type, value) {
  return IsRef(type) ? guard_exports.HasPropertyKey(context, type.$ref) ? Deref(context, context[type.$ref], value) : (() => {
    throw new Error("Unable to Deref target");
  })() : type;
}
function ScoreVariant(context, type, value) {
  if (!(IsObject2(type) && guard_exports.IsObject(value)))
    return 0;
  const keys = guard_exports.Keys(value);
  const entries = guard_exports.Entries(type.properties);
  return entries.reduce((result, [key, schema]) => {
    const literal = IsLiteral(schema) && guard_exports.IsEqual(schema.const, value[key]) ? 100 : 0;
    const checks = Check2(context, schema, value[key]) ? 10 : 0;
    const exists = keys.includes(key) ? 1 : 0;
    return result + (literal + checks + exists);
  }, 0);
}
function UnionScoreSelect(context, type, value) {
  const schemas = type.anyOf.map((schema) => Deref(context, schema, value));
  let [select, best] = [schemas[0], 0];
  for (const schema of schemas) {
    const score = ScoreVariant(context, schema, value);
    if (score > best) {
      select = schema;
      best = score;
    }
  }
  return select;
}
var init_union_score_select = __esm({
  "node_modules/typebox/build/value/shared/union_score_select.mjs"() {
    init_type3();
    init_guard2();
    init_check4();
  }
});

// node_modules/typebox/build/value/repair/from_union.mjs
function RepairUnion(context, type, value) {
  const union = Union(Flatten(type.anyOf));
  const schema = UnionScoreSelect(context, union, value);
  return FromType26(context, schema, value);
}
function FromUnion15(context, type, value) {
  if (Check2(context, type, value))
    return Clone2(value);
  if (IsDefault(type))
    return Create2(context, type);
  return RepairUnion(context, type, value);
}
var init_from_union12 = __esm({
  "node_modules/typebox/build/value/repair/from_union.mjs"() {
    init_types2();
    init_type3();
    init_evaluate3();
    init_check4();
    init_clone3();
    init_create4();
    init_from_type16();
    init_union_score_select();
  }
});

// node_modules/typebox/build/value/repair/from_unknown.mjs
function FromUnknown2(context, type, value) {
  if (Check2(context, type, value))
    return value;
  const converted = Convert(context, type, value);
  if (Check2(context, type, converted))
    return converted;
  return Create2(context, type);
}
var init_from_unknown = __esm({
  "node_modules/typebox/build/value/repair/from_unknown.mjs"() {
    init_check4();
    init_create4();
    init_convert2();
  }
});

// node_modules/typebox/build/value/repair/from_type.mjs
function AssertRepairableValue(context, type, value) {
  const unsupported = globals_exports.IsDate(value) || globals_exports.IsMap(value) || globals_exports.IsSet(value) || globals_exports.IsTypeArray(value) || guard_exports.IsConstructor(value) || guard_exports.IsFunction(value);
  if (unsupported) {
    throw new RepairError(context, type, value, "Value is not repairable");
  }
}
function AssertRepairableType(context, type, value) {
  const unsupported = IsConstructor2(type) || IsFunction2(type) || IsNever(type);
  if (unsupported) {
    throw new RepairError(context, type, value, "Type is not repairable");
  }
}
function CreateWhenUndefined(context, type, value) {
  return guard_exports.IsUndefined(value) && !IsUndefined2(type) ? Create2(context, type) : value;
}
function FinalizeRepair(context, type, repaired) {
  return IsRefine(type) ? Check2(context, type, repaired) ? repaired : Create2(context, type) : repaired;
}
function FromType26(context, type, value) {
  AssertRepairableValue(context, type, value);
  AssertRepairableType(context, type, value);
  const candidate = CreateWhenUndefined(context, type, value);
  const repaired = IsArray2(type) ? FromArray14(context, type, candidate) : IsEnum(type) ? FromEnum5(context, type, candidate) : IsIntersect(type) ? FromIntersect12(context, type, candidate) : IsObject2(type) ? FromObject18(context, type, candidate) : IsRecord(type) ? FromRecord9(context, type, candidate) : IsRef(type) ? FromRef11(context, type, candidate) : IsTemplateLiteral(type) ? FromTemplateLiteral6(context, type, candidate) : IsTuple(type) ? FromTuple11(context, type, candidate) : IsUnion(type) ? FromUnion15(context, type, candidate) : FromUnknown2(context, type, candidate);
  return FinalizeRepair(context, type, repaired);
}
var init_from_type16 = __esm({
  "node_modules/typebox/build/value/repair/from_type.mjs"() {
    init_guard2();
    init_type3();
    init_check4();
    init_create4();
    init_from_array9();
    init_from_enum4();
    init_from_intersect11();
    init_from_object12();
    init_from_record7();
    init_from_ref6();
    init_from_template_literal5();
    init_from_tuple10();
    init_from_union12();
    init_from_unknown();
    init_error2();
  }
});

// node_modules/typebox/build/value/repair/repair.mjs
function Repair(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const repaired = FromType26(context, type, value);
  Assert(context, type, repaired);
  return repaired;
}
var init_repair = __esm({
  "node_modules/typebox/build/value/repair/repair.mjs"() {
    init_arguments2();
    init_from_type16();
    init_assert2();
  }
});

// node_modules/typebox/build/value/repair/index.mjs
var init_repair2 = __esm({
  "node_modules/typebox/build/value/repair/index.mjs"() {
    init_repair();
  }
});

// node_modules/typebox/build/value/shared/index.mjs
var init_shared = __esm({
  "node_modules/typebox/build/value/shared/index.mjs"() {
    init_optional_undefined();
    init_union_priority_sort();
    init_union_score_select();
  }
});

// node_modules/typebox/build/value/value.mjs
var value_exports = {};
__export(value_exports, {
  Assert: () => Assert,
  Check: () => Check2,
  Clean: () => Clean,
  Clone: () => Clone2,
  Convert: () => Convert,
  Create: () => Create2,
  Decode: () => Decode10,
  Default: () => Default,
  Diff: () => Diff,
  Encode: () => Encode9,
  Equal: () => Equal,
  Errors: () => Errors2,
  HasCodec: () => HasCodec,
  Hash: () => Hash2,
  Parse: () => Parse,
  Patch: () => Patch,
  Pointer: () => pointer_exports,
  Repair: () => Repair
});
var init_value = __esm({
  "node_modules/typebox/build/value/value.mjs"() {
    init_assert2();
    init_check4();
    init_clean2();
    init_clone3();
    init_codec2();
    init_convert2();
    init_create4();
    init_default3();
    init_equal2();
    init_errors3();
    init_hash3();
    init_parse3();
    init_delta();
    init_pointer3();
    init_repair2();
  }
});

// node_modules/typebox/build/value/index.mjs
var init_value2 = __esm({
  "node_modules/typebox/build/value/index.mjs"() {
    init_assert2();
    init_check4();
    init_clean2();
    init_clone3();
    init_codec2();
    init_convert2();
    init_create4();
    init_errors3();
    init_default3();
    init_equal2();
    init_hash3();
    init_parse3();
    init_delta();
    init_pipeline2();
    init_pointer3();
    init_repair2();
    init_shared();
    init_value();
    init_value();
  }
});

// packages/contracts/dist/index.js
function isDataAgentCommandEnvelope(value) {
  return value_exports.Check(DataAgentCommandEnvelopeSchema, value);
}
function parseDataAgentCommandEnvelope(value) {
  if (!isDataAgentCommandEnvelope(value))
    throw new TypeError("Invalid DataAgent command envelope");
  return value;
}
var ProtocolVersion, RequestContextSchema, RuntimeProbeCommandSchema, AgentPromptCommandSchema, AgentSteerCommandSchema, AgentFollowUpCommandSchema, AgentStopCommandSchema, WorkspaceListCommandSchema, WorkspaceReadCommandSchema, WorkspaceWriteCommandSchema, WorkspaceDeleteCommandSchema, RunPythonCommandSchema, KnowledgeSearchCommandSchema, KnowledgeReadCommandSchema, ClarificationAnswerCommandSchema, KnowledgeListCommandSchema, KnowledgeSaveCommandSchema, DashboardV3DataCommandSchema, ConfigGetCommandSchema, ConfigSaveCommandSchema, PythonRuntimeTestCommandSchema, DbTestCommandSchema, LlmTestCommandSchema, ConfigLlmListCommandSchema, ConfigLlmSaveCommandSchema, McpServersStatusCommandSchema, McpServerTestCommandSchema, McpServerRestartCommandSchema, SessionTranscriptCommandSchema, SessionPrepareCommandSchema, SemanticSourcesListCommandSchema, SemanticSourcesGetCommandSchema, McpConfigGetCommandSchema, McpConfigSaveCommandSchema, SkillsListCommandSchema, DashboardEvaluateCommandSchema, SemanticIngestStatusCommandSchema, SemanticIngestRetryCommandSchema, DashboardMigrateCommandSchema, DashboardCommandSchema, TaskCreateCommandSchema, TaskListCommandSchema, TaskRenameCommandSchema, TaskDeleteCommandSchema, SessionCreateCommandSchema, SessionListCommandSchema, SessionRenameCommandSchema, SessionDeleteCommandSchema, DataAgentCommandSchema, DataAgentCommandEnvelopeSchema, RuntimeProbeResponseSchema, AgentPromptResponseSchema, KnowledgeSearchResponseSchema, KnowledgeReadResponseSchema, KnowledgeListResponseSchema, KnowledgeSaveResponseSchema, SemanticSourcesResponseSchema, SemanticSourceResponseSchema, McpConfigResponseSchema, SkillsListResponseSchema, DashboardEvaluateResponseSchema, SemanticIngestStatusResponseSchema, SemanticIngestRetryResponseSchema, SessionTranscriptResponseSchema, DashboardV3DataResponseSchema, ConfigGetResponseSchema, ConfigSaveResponseSchema, SimpleTestResponseSchema, ConfigLlmListResponseSchema, ConfigLlmSaveResponseSchema, McpServersStatusResponseSchema, McpServerTestResponseSchema, McpServerRestartResponseSchema, DashboardResponseSchema, DashboardMigrateResponseSchema, PythonResponseSchema, WorkspaceResponseSchema, TaskSchema, SessionSchema, MutationResponseSchema, ListResponseSchema, DataAgentResponseSchema, DataAgentResponseEnvelopeSchema, DataAgentEventSchema, DataAgentEventEnvelopeSchema;
var init_dist = __esm({
  "packages/contracts/dist/index.js"() {
    "use strict";
    init_build();
    init_value2();
    ProtocolVersion = 1;
    RequestContextSchema = typebox_exports.Object({ userId: typebox_exports.String({ minLength: 1 }), host: typebox_exports.Union([typebox_exports.Literal("electron"), typebox_exports.Literal("web")]), sessionId: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })) });
    RuntimeProbeCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("runtime.probe") });
    AgentPromptCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("agent.prompt"), prompt: typebox_exports.String({ minLength: 1 }) });
    AgentSteerCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("agent.steer"), prompt: typebox_exports.String({ minLength: 1 }) });
    AgentFollowUpCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("agent.follow_up"), prompt: typebox_exports.String({ minLength: 1 }) });
    AgentStopCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("agent.stop") });
    WorkspaceListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("workspace.list") });
    WorkspaceReadCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("workspace.read"), path: typebox_exports.String({ minLength: 1 }) });
    WorkspaceWriteCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("workspace.write"), path: typebox_exports.String({ minLength: 1 }), content: typebox_exports.String() });
    WorkspaceDeleteCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("workspace.delete"), path: typebox_exports.String({ minLength: 1 }) });
    RunPythonCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("python.run"), code: typebox_exports.String({ minLength: 1 }), description: typebox_exports.Optional(typebox_exports.String()) });
    KnowledgeSearchCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.search"), query: typebox_exports.String({ minLength: 1 }) });
    KnowledgeReadCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.read"), path: typebox_exports.String({ minLength: 1 }) });
    ClarificationAnswerCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("clarification.answer"), clarificationId: typebox_exports.String({ minLength: 1 }), answer: typebox_exports.String() });
    KnowledgeListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.list") });
    KnowledgeSaveCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.save"), path: typebox_exports.String({ minLength: 1 }), content: typebox_exports.String() });
    DashboardV3DataCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.v3.data"), path: typebox_exports.String({ minLength: 1 }) });
    ConfigGetCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.get") });
    ConfigSaveCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.save"), patch: typebox_exports.Record(typebox_exports.String(), typebox_exports.Unknown()) });
    PythonRuntimeTestCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("python.runtime.test"), mode: typebox_exports.Union([typebox_exports.Literal("bundled"), typebox_exports.Literal("external")]), executable: typebox_exports.Optional(typebox_exports.String()) });
    DbTestCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("db.test"), connection: typebox_exports.Record(typebox_exports.String(), typebox_exports.Unknown()) });
    LlmTestCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("llm.test"), profile: typebox_exports.Record(typebox_exports.String(), typebox_exports.Unknown()) });
    ConfigLlmListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.llm.list") });
    ConfigLlmSaveCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.llm.save"), profile: typebox_exports.Object({ id: typebox_exports.Optional(typebox_exports.String()), provider: typebox_exports.String(), model: typebox_exports.String(), apiKey: typebox_exports.Optional(typebox_exports.String()) }) });
    McpServersStatusCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.servers.status") });
    McpServerTestCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.server.test"), name: typebox_exports.String({ minLength: 1 }) });
    McpServerRestartCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.server.restart"), name: typebox_exports.String({ minLength: 1 }) });
    SessionTranscriptCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.transcript"), sessionId: typebox_exports.String({ minLength: 1 }) });
    SessionPrepareCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.prepare"), sessionId: typebox_exports.String({ minLength: 1 }) });
    SemanticSourcesListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.sources.list") });
    SemanticSourcesGetCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.sources.get"), connectionId: typebox_exports.String(), sourceName: typebox_exports.String() });
    McpConfigGetCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.config.get") });
    McpConfigSaveCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.config.save"), config: typebox_exports.Unknown() });
    SkillsListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("skills.list") });
    DashboardEvaluateCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.evaluate"), sql: typebox_exports.String({ minLength: 1 }), rowLimit: typebox_exports.Optional(typebox_exports.Number({ minimum: 1, maximum: 1e4 })) });
    SemanticIngestStatusCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.ingest.status") });
    SemanticIngestRetryCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.ingest.retry") });
    DashboardMigrateCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.migrate"), paths: typebox_exports.Array(typebox_exports.String({ minLength: 1 }), { minItems: 1 }) });
    DashboardCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.generate"), operation: typebox_exports.Union([typebox_exports.Literal("create"), typebox_exports.Literal("edit"), typebox_exports.Literal("validate")]), mode: typebox_exports.Union([typebox_exports.Literal("static"), typebox_exports.Literal("semantic")]), version: typebox_exports.Union([typebox_exports.Literal("v3"), typebox_exports.Literal("v4")]), spec: typebox_exports.Unknown(), editPath: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })) });
    TaskCreateCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("task.create"), name: typebox_exports.String({ minLength: 1 }) });
    TaskListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("task.list") });
    TaskRenameCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("task.rename"), taskId: typebox_exports.String({ minLength: 1 }), name: typebox_exports.String({ minLength: 1 }) });
    TaskDeleteCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("task.delete"), taskId: typebox_exports.String({ minLength: 1 }) });
    SessionCreateCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.create"), taskId: typebox_exports.String({ minLength: 1 }), name: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })) });
    SessionListCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.list"), taskId: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })) });
    SessionRenameCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.rename"), sessionId: typebox_exports.String({ minLength: 1 }), name: typebox_exports.String({ minLength: 1 }) });
    SessionDeleteCommandSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.delete"), sessionId: typebox_exports.String({ minLength: 1 }) });
    DataAgentCommandSchema = typebox_exports.Union([RuntimeProbeCommandSchema, AgentPromptCommandSchema, AgentSteerCommandSchema, AgentFollowUpCommandSchema, AgentStopCommandSchema, WorkspaceListCommandSchema, WorkspaceReadCommandSchema, WorkspaceWriteCommandSchema, WorkspaceDeleteCommandSchema, RunPythonCommandSchema, KnowledgeSearchCommandSchema, KnowledgeReadCommandSchema, ClarificationAnswerCommandSchema, KnowledgeListCommandSchema, KnowledgeSaveCommandSchema, DashboardV3DataCommandSchema, ConfigGetCommandSchema, ConfigSaveCommandSchema, PythonRuntimeTestCommandSchema, DbTestCommandSchema, LlmTestCommandSchema, ConfigLlmListCommandSchema, ConfigLlmSaveCommandSchema, McpServersStatusCommandSchema, McpServerTestCommandSchema, McpServerRestartCommandSchema, SessionPrepareCommandSchema, SessionTranscriptCommandSchema, SemanticSourcesListCommandSchema, SemanticSourcesGetCommandSchema, McpConfigGetCommandSchema, McpConfigSaveCommandSchema, SkillsListCommandSchema, DashboardEvaluateCommandSchema, DashboardMigrateCommandSchema, SemanticIngestStatusCommandSchema, SemanticIngestRetryCommandSchema, DashboardCommandSchema, TaskCreateCommandSchema, TaskListCommandSchema, TaskRenameCommandSchema, TaskDeleteCommandSchema, SessionCreateCommandSchema, SessionListCommandSchema, SessionRenameCommandSchema, SessionDeleteCommandSchema]);
    DataAgentCommandEnvelopeSchema = typebox_exports.Object({ protocolVersion: typebox_exports.Integer({ minimum: 1 }), requestId: typebox_exports.String({ minLength: 1 }), command: DataAgentCommandSchema });
    RuntimeProbeResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("runtime.probe.result"), service: typebox_exports.Literal("data-agent-runtime"), runtimeVersion: typebox_exports.Literal("0.1.0") });
    AgentPromptResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("agent.prompt.accepted"), runId: typebox_exports.String({ minLength: 1 }) });
    KnowledgeSearchResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.search.result"), hits: typebox_exports.Array(typebox_exports.Object({ path: typebox_exports.String(), title: typebox_exports.String(), category: typebox_exports.String(), chunkId: typebox_exports.String(), startLine: typebox_exports.Integer(), endLine: typebox_exports.Integer(), score: typebox_exports.Number(), revision: typebox_exports.Integer() })) });
    KnowledgeReadResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.read.result"), path: typebox_exports.String(), content: typebox_exports.String() });
    KnowledgeListResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.list.result"), files: typebox_exports.Array(typebox_exports.Object({ path: typebox_exports.String(), size: typebox_exports.Number(), modifiedAt: typebox_exports.Number() })) });
    KnowledgeSaveResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("knowledge.save.result"), path: typebox_exports.String() });
    SemanticSourcesResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.sources.result"), sources: typebox_exports.Array(typebox_exports.Object({ connectionId: typebox_exports.String(), sourceName: typebox_exports.String(), definition: typebox_exports.Unknown(), updatedAt: typebox_exports.Number() })) });
    SemanticSourceResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.source.result"), source: typebox_exports.Object({ connectionId: typebox_exports.String(), sourceName: typebox_exports.String(), definition: typebox_exports.Unknown(), updatedAt: typebox_exports.Number() }) });
    McpConfigResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.config.result"), config: typebox_exports.Unknown() });
    SkillsListResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("skills.list.result"), skills: typebox_exports.Array(typebox_exports.Object({ name: typebox_exports.String(), description: typebox_exports.String(), tools: typebox_exports.Array(typebox_exports.String()) })) });
    DashboardEvaluateResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.evaluate.result"), columns: typebox_exports.Array(typebox_exports.String()), rows: typebox_exports.Array(typebox_exports.Array(typebox_exports.Unknown())), rowCount: typebox_exports.Number(), truncated: typebox_exports.Boolean() });
    SemanticIngestStatusResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.ingest.status.result"), status: typebox_exports.String(), jobId: typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]), summary: typebox_exports.Object({ updated: typebox_exports.Number(), unchanged: typebox_exports.Number(), failed: typebox_exports.Number(), skipped: typebox_exports.Number() }), errorCode: typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]) });
    SemanticIngestRetryResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("semantic.ingest.retry.result"), accepted: typebox_exports.Boolean() });
    SessionTranscriptResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("session.transcript.result"), messages: typebox_exports.Array(typebox_exports.Object({ id: typebox_exports.String(), role: typebox_exports.String(), content: typebox_exports.String(), timestamp: typebox_exports.Number() })) });
    DashboardV3DataResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.v3.data.result"), payload: typebox_exports.Unknown() });
    ConfigGetResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.get.result"), config: typebox_exports.Unknown() });
    ConfigSaveResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.save.result"), saved: typebox_exports.Boolean() });
    SimpleTestResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("test.result"), success: typebox_exports.Boolean(), message: typebox_exports.String(), details: typebox_exports.Optional(typebox_exports.Unknown()) });
    ConfigLlmListResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.llm.list.result"), profiles: typebox_exports.Array(typebox_exports.Unknown()) });
    ConfigLlmSaveResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("config.llm.save.result"), profile: typebox_exports.Unknown() });
    McpServersStatusResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.servers.status.result"), servers: typebox_exports.Array(typebox_exports.Object({ name: typebox_exports.String(), enabled: typebox_exports.Boolean(), connected: typebox_exports.Boolean(), toolCount: typebox_exports.Number(), hostManaged: typebox_exports.Boolean() })) });
    McpServerTestResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.server.test.result"), ok: typebox_exports.Boolean(), message: typebox_exports.String() });
    McpServerRestartResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("mcp.server.restart.result"), ok: typebox_exports.Boolean() });
    DashboardResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.result"), valid: typebox_exports.Boolean(), errors: typebox_exports.Array(typebox_exports.String()), path: typebox_exports.Optional(typebox_exports.String()), bytes: typebox_exports.Optional(typebox_exports.Number()) });
    DashboardMigrateResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("dashboard.migrate.result"), migrationId: typebox_exports.String(), fromVersion: typebox_exports.Literal("v3"), toVersion: typebox_exports.Literal("v4"), converted: typebox_exports.Array(typebox_exports.String()), unchanged: typebox_exports.Array(typebox_exports.String()), unsupported: typebox_exports.Array(typebox_exports.Object({ path: typebox_exports.String(), reasons: typebox_exports.Array(typebox_exports.String()) })) });
    PythonResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("python.result"), jobId: typebox_exports.String(), status: typebox_exports.Union([typebox_exports.Literal("success"), typebox_exports.Literal("error"), typebox_exports.Literal("timeout"), typebox_exports.Literal("aborted")]), exitCode: typebox_exports.Union([typebox_exports.Number(), typebox_exports.Null()]), stdout: typebox_exports.String(), stderr: typebox_exports.String(), scriptPath: typebox_exports.String(), durationMs: typebox_exports.Number() });
    WorkspaceResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("workspace.result"), operation: typebox_exports.Union([typebox_exports.Literal("list"), typebox_exports.Literal("read"), typebox_exports.Literal("write")]), path: typebox_exports.Optional(typebox_exports.String()), content: typebox_exports.Optional(typebox_exports.String()), files: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String())) });
    TaskSchema = typebox_exports.Object({ id: typebox_exports.String(), name: typebox_exports.String(), createdAt: typebox_exports.Number(), updatedAt: typebox_exports.Number() });
    SessionSchema = typebox_exports.Object({ id: typebox_exports.String(), taskId: typebox_exports.String(), name: typebox_exports.String(), createdAt: typebox_exports.Number(), updatedAt: typebox_exports.Number() });
    MutationResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("mutation.result"), entity: typebox_exports.Union([typebox_exports.Literal("task"), typebox_exports.Literal("session")]), item: typebox_exports.Union([TaskSchema, SessionSchema]) });
    ListResponseSchema = typebox_exports.Object({ type: typebox_exports.Literal("list.result"), entity: typebox_exports.Union([typebox_exports.Literal("task"), typebox_exports.Literal("session")]), items: typebox_exports.Array(typebox_exports.Union([TaskSchema, SessionSchema])) });
    DataAgentResponseSchema = typebox_exports.Union([RuntimeProbeResponseSchema, AgentPromptResponseSchema, KnowledgeSearchResponseSchema, KnowledgeReadResponseSchema, KnowledgeListResponseSchema, KnowledgeSaveResponseSchema, SemanticSourcesResponseSchema, SemanticSourceResponseSchema, McpConfigResponseSchema, SkillsListResponseSchema, DashboardEvaluateResponseSchema, SemanticIngestStatusResponseSchema, SemanticIngestRetryResponseSchema, SessionTranscriptResponseSchema, DashboardV3DataResponseSchema, ConfigGetResponseSchema, ConfigSaveResponseSchema, SimpleTestResponseSchema, ConfigLlmListResponseSchema, ConfigLlmSaveResponseSchema, McpServersStatusResponseSchema, McpServerTestResponseSchema, McpServerRestartResponseSchema, DashboardResponseSchema, DashboardMigrateResponseSchema, PythonResponseSchema, WorkspaceResponseSchema, MutationResponseSchema, ListResponseSchema]);
    DataAgentResponseEnvelopeSchema = typebox_exports.Object({ protocolVersion: typebox_exports.Literal(ProtocolVersion), requestId: typebox_exports.String({ minLength: 1 }), response: DataAgentResponseSchema });
    DataAgentEventSchema = typebox_exports.Union([typebox_exports.Object({ type: typebox_exports.Literal("runtime.probe.completed"), service: typebox_exports.Literal("data-agent-runtime") }), typebox_exports.Object({ type: typebox_exports.Literal("agent.text_delta"), delta: typebox_exports.String() }), typebox_exports.Object({ type: typebox_exports.Literal("agent.thinking_delta"), delta: typebox_exports.String() }), typebox_exports.Object({ type: typebox_exports.Literal("agent.message_started"), messageId: typebox_exports.String() }), typebox_exports.Object({ type: typebox_exports.Literal("agent.tool_started"), toolCallId: typebox_exports.String(), toolName: typebox_exports.String(), args: typebox_exports.Unknown() }), typebox_exports.Object({ type: typebox_exports.Literal("agent.tool_finished"), toolCallId: typebox_exports.String(), toolName: typebox_exports.String(), result: typebox_exports.Unknown(), isError: typebox_exports.Boolean() }), typebox_exports.Object({ type: typebox_exports.Literal("agent.completed") }), typebox_exports.Object({ type: typebox_exports.Literal("workspace.artifact.created"), path: typebox_exports.String(), kind: typebox_exports.Literal("file") }), typebox_exports.Object({ type: typebox_exports.Literal("clarification.request"), clarificationId: typebox_exports.String(), question: typebox_exports.String(), options: typebox_exports.Array(typebox_exports.String()) }), typebox_exports.Object({ type: typebox_exports.Literal("clarification.settled"), clarificationId: typebox_exports.String(), outcome: typebox_exports.Union([typebox_exports.Literal("answered"), typebox_exports.Literal("expired"), typebox_exports.Literal("cancelled")]) })]);
    DataAgentEventEnvelopeSchema = typebox_exports.Object({ protocolVersion: typebox_exports.Literal(ProtocolVersion), sequence: typebox_exports.Integer({ minimum: 1 }), requestId: typebox_exports.String({ minLength: 1 }), sessionId: typebox_exports.Optional(typebox_exports.String()), runId: typebox_exports.Optional(typebox_exports.String()), timestamp: typebox_exports.Integer({ minimum: 0 }), event: DataAgentEventSchema });
  }
});

// packages/runtime/dist/metadata.js
var import_node_worker_threads, import_node_crypto, import_node_path, import_node_fs, MetadataStore;
var init_metadata = __esm({
  "packages/runtime/dist/metadata.js"() {
    "use strict";
    import_node_worker_threads = require("node:worker_threads");
    import_node_crypto = require("node:crypto");
    import_node_path = __toESM(require("node:path"), 1);
    import_node_fs = require("node:fs");
    MetadataStore = class {
      worker;
      next = 1;
      pending = /* @__PURE__ */ new Map();
      constructor(dbPath) {
        const sourceDir = false ? import_node_path.default.dirname((0, import_node_url.fileURLToPath)(void 0)) : __dirname;
        (0, import_node_fs.mkdirSync)(import_node_path.default.dirname(import_node_path.default.resolve(dbPath)), { recursive: true });
        const workerPath = import_node_path.default.join(sourceDir, "metadata-worker.js");
        const builtWorkerPath = import_node_path.default.resolve(sourceDir, "../dist/metadata-worker.js");
        this.worker = new import_node_worker_threads.Worker((0, import_node_fs.existsSync)(workerPath) ? workerPath : builtWorkerPath, { workerData: { path: import_node_path.default.resolve(dbPath) } });
        this.worker.on("message", (message) => {
          const p = this.pending.get(message.id);
          if (!p)
            return;
          this.pending.delete(message.id);
          message.ok ? p.resolve(message.result) : p.reject(new Error(message.error));
        });
        this.worker.on("error", (error) => {
          for (const p of this.pending.values())
            p.reject(error);
          this.pending.clear();
        });
      }
      call(op, userId, values = {}) {
        const id = this.next++;
        return new Promise((resolve2, reject) => {
          this.pending.set(id, { resolve: resolve2, reject });
          this.worker.postMessage({ id, op, userId, ...values });
        });
      }
      async knowledgeCachePut(cachePath, revision, payload) {
        await this.call("knowledge.cache_put", "system", { cachePath, revision, payload: JSON.stringify(payload) });
      }
      async knowledgeCacheGet(cachePath, revision) {
        return this.call("knowledge.cache_get", "system", { cachePath, revision });
      }
      async knowledgeCacheClear() {
        await this.call("knowledge.cache_clear", "system");
      }
      async pendingOutbox() {
        return this.call("outbox.list", "system");
      }
      async close() {
        await this.worker.terminate();
      }
      static createId() {
        return (0, import_node_crypto.randomUUID)();
      }
      async getConfig(key) {
        const row = await this.call("config.get", "system", { configKey: key });
        return row ? JSON.parse(row.value) : null;
      }
      async setConfig(key, value) {
        await this.call("config.set", "system", { configKey: key, valueJson: JSON.stringify(value) });
      }
      async listSemanticSources() {
        return this.call("semantic.list", "system");
      }
      async getSemanticSource(connectionId, sourceName) {
        return this.call("semantic.get", "system", { connectionId, sourceName });
      }
      async upsertSemanticSource(connectionId, sourceName, definition) {
        await this.call("semantic.upsert", "system", { connectionId, sourceName, definitionJson: JSON.stringify(definition) });
      }
    };
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js
var init_event_stream = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/api/lazy.js
var init_lazy = __esm({
  "node_modules/@earendil-works/pi-ai/dist/api/lazy.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/auth/context.js
var init_context2 = __esm({
  "node_modules/@earendil-works/pi-ai/dist/auth/context.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/auth/credential-store.js
var init_credential_store = __esm({
  "node_modules/@earendil-works/pi-ai/dist/auth/credential-store.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/auth/helpers.js
var init_helpers2 = __esm({
  "node_modules/@earendil-works/pi-ai/dist/auth/helpers.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/auth/types.js
var init_types3 = __esm({
  "node_modules/@earendil-works/pi-ai/dist/auth/types.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/diagnostics.js
var init_diagnostics = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/diagnostics.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/images-models.js
var init_images_models = __esm({
  "node_modules/@earendil-works/pi-ai/dist/images-models.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/models-store.js
var init_models_store = __esm({
  "node_modules/@earendil-works/pi-ai/dist/models-store.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/models.js
var init_models = __esm({
  "node_modules/@earendil-works/pi-ai/dist/models.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/providers/faux.js
var init_faux = __esm({
  "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/session-resources.js
var init_session_resources = __esm({
  "node_modules/@earendil-works/pi-ai/dist/session-resources.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/types.js
var init_types4 = __esm({
  "node_modules/@earendil-works/pi-ai/dist/types.js"() {
  }
});

// node_modules/partial-json/dist/options.js
var require_options = __commonJS({
  "node_modules/partial-json/dist/options.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Allow = exports2.ALL = exports2.COLLECTION = exports2.ATOM = exports2.SPECIAL = exports2.INF = exports2._INFINITY = exports2.INFINITY = exports2.NAN = exports2.BOOL = exports2.NULL = exports2.OBJ = exports2.ARR = exports2.NUM = exports2.STR = void 0;
    exports2.STR = 1;
    exports2.NUM = 2;
    exports2.ARR = 4;
    exports2.OBJ = 8;
    exports2.NULL = 16;
    exports2.BOOL = 32;
    exports2.NAN = 64;
    exports2.INFINITY = 128;
    exports2._INFINITY = 256;
    exports2.INF = exports2.INFINITY | exports2._INFINITY;
    exports2.SPECIAL = exports2.NULL | exports2.BOOL | exports2.INF | exports2.NAN;
    exports2.ATOM = exports2.STR | exports2.NUM | exports2.SPECIAL;
    exports2.COLLECTION = exports2.ARR | exports2.OBJ;
    exports2.ALL = exports2.ATOM | exports2.COLLECTION;
    exports2.Allow = { STR: exports2.STR, NUM: exports2.NUM, ARR: exports2.ARR, OBJ: exports2.OBJ, NULL: exports2.NULL, BOOL: exports2.BOOL, NAN: exports2.NAN, INFINITY: exports2.INFINITY, _INFINITY: exports2._INFINITY, INF: exports2.INF, SPECIAL: exports2.SPECIAL, ATOM: exports2.ATOM, COLLECTION: exports2.COLLECTION, ALL: exports2.ALL };
    exports2.default = exports2.Allow;
  }
});

// node_modules/partial-json/dist/index.js
var require_dist = __commonJS({
  "node_modules/partial-json/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Allow = exports2.MalformedJSON = exports2.PartialJSON = exports2.parseJSON = exports2.parse = void 0;
    var options_1 = require_options();
    Object.defineProperty(exports2, "Allow", { enumerable: true, get: function() {
      return options_1.Allow;
    } });
    __exportStar(require_options(), exports2);
    var PartialJSON = class extends Error {
    };
    exports2.PartialJSON = PartialJSON;
    var MalformedJSON = class extends Error {
    };
    exports2.MalformedJSON = MalformedJSON;
    function parseJSON(jsonString, allowPartial = options_1.Allow.ALL) {
      if (typeof jsonString !== "string") {
        throw new TypeError(`expecting str, got ${typeof jsonString}`);
      }
      if (!jsonString.trim()) {
        throw new Error(`${jsonString} is empty`);
      }
      return _parseJSON(jsonString.trim(), allowPartial);
    }
    exports2.parseJSON = parseJSON;
    var _parseJSON = (jsonString, allow) => {
      const length = jsonString.length;
      let index = 0;
      const markPartialJSON = (msg) => {
        throw new PartialJSON(`${msg} at position ${index}`);
      };
      const throwMalformedError = (msg) => {
        throw new MalformedJSON(`${msg} at position ${index}`);
      };
      const parseAny = () => {
        skipBlank();
        if (index >= length)
          markPartialJSON("Unexpected end of input");
        if (jsonString[index] === '"')
          return parseStr();
        if (jsonString[index] === "{")
          return parseObj();
        if (jsonString[index] === "[")
          return parseArr();
        if (jsonString.substring(index, index + 4) === "null" || options_1.Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index))) {
          index += 4;
          return null;
        }
        if (jsonString.substring(index, index + 4) === "true" || options_1.Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index))) {
          index += 4;
          return true;
        }
        if (jsonString.substring(index, index + 5) === "false" || options_1.Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index))) {
          index += 5;
          return false;
        }
        if (jsonString.substring(index, index + 8) === "Infinity" || options_1.Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index))) {
          index += 8;
          return Infinity;
        }
        if (jsonString.substring(index, index + 9) === "-Infinity" || options_1.Allow._INFINITY & allow && 1 < length - index && length - index < 9 && "-Infinity".startsWith(jsonString.substring(index))) {
          index += 9;
          return -Infinity;
        }
        if (jsonString.substring(index, index + 3) === "NaN" || options_1.Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index))) {
          index += 3;
          return NaN;
        }
        return parseNum();
      };
      const parseStr = () => {
        const start = index;
        let escape = false;
        index++;
        while (index < length && (jsonString[index] !== '"' || escape && jsonString[index - 1] === "\\")) {
          escape = jsonString[index] === "\\" ? !escape : false;
          index++;
        }
        if (jsonString.charAt(index) == '"') {
          try {
            return JSON.parse(jsonString.substring(start, ++index - Number(escape)));
          } catch (e) {
            throwMalformedError(String(e));
          }
        } else if (options_1.Allow.STR & allow) {
          try {
            return JSON.parse(jsonString.substring(start, index - Number(escape)) + '"');
          } catch (e) {
            return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("\\")) + '"');
          }
        }
        markPartialJSON("Unterminated string literal");
      };
      const parseObj = () => {
        index++;
        skipBlank();
        const obj = {};
        try {
          while (jsonString[index] !== "}") {
            skipBlank();
            if (index >= length && options_1.Allow.OBJ & allow)
              return obj;
            const key = parseStr();
            skipBlank();
            index++;
            try {
              const value = parseAny();
              obj[key] = value;
            } catch (e) {
              if (options_1.Allow.OBJ & allow)
                return obj;
              else
                throw e;
            }
            skipBlank();
            if (jsonString[index] === ",")
              index++;
          }
        } catch (e) {
          if (options_1.Allow.OBJ & allow)
            return obj;
          else
            markPartialJSON("Expected '}' at end of object");
        }
        index++;
        return obj;
      };
      const parseArr = () => {
        index++;
        const arr = [];
        try {
          while (jsonString[index] !== "]") {
            arr.push(parseAny());
            skipBlank();
            if (jsonString[index] === ",") {
              index++;
            }
          }
        } catch (e) {
          if (options_1.Allow.ARR & allow) {
            return arr;
          }
          markPartialJSON("Expected ']' at end of array");
        }
        index++;
        return arr;
      };
      const parseNum = () => {
        if (index === 0) {
          if (jsonString === "-")
            throwMalformedError("Not sure what '-' is");
          try {
            return JSON.parse(jsonString);
          } catch (e) {
            if (options_1.Allow.NUM & allow)
              try {
                return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e")));
              } catch (e2) {
              }
            throwMalformedError(String(e));
          }
        }
        const start = index;
        if (jsonString[index] === "-")
          index++;
        while (jsonString[index] && ",]}".indexOf(jsonString[index]) === -1)
          index++;
        if (index == length && !(options_1.Allow.NUM & allow))
          markPartialJSON("Unterminated number literal");
        try {
          return JSON.parse(jsonString.substring(start, index));
        } catch (e) {
          if (jsonString.substring(start, index) === "-")
            markPartialJSON("Not sure what '-' is");
          try {
            return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e")));
          } catch (e2) {
            throwMalformedError(String(e2));
          }
        }
      };
      const skipBlank = () => {
        while (index < length && " \n\r	".includes(jsonString[index])) {
          index++;
        }
      };
      return parseAny();
    };
    var parse3 = parseJSON;
    exports2.parse = parse3;
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js
var import_partial_json;
var init_json_parse = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js"() {
    import_partial_json = __toESM(require_dist(), 1);
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/overflow.js
var init_overflow = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/overflow.js"() {
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/retry.js
function buildProviderErrorPattern(patterns) {
  return new RegExp(patterns.join("|"), "i");
}
var NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN, RETRYABLE_PROVIDER_ERROR_PATTERN;
var init_retry = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/retry.js"() {
    NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
      // OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
      // Zen API. These are subscription/account limits, not transient throttles.
      "GoUsageLimitError",
      "FreeUsageLimitError",
      // OpenCode Go subscription-limit text asks users to enable available-balance
      // usage after rolling/weekly/monthly limits are reached.
      "Monthly usage limit reached",
      "available balance",
      // Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
      // quota/billing error code; the other strings cover common gateway wording.
      "insufficient_quota",
      "out of budget",
      "quota exceeded",
      "billing"
    ]);
    RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
      // Generic provider load, HTTP status, and server-side transient failures.
      "overloaded",
      "rate.?limit",
      "too many requests",
      "429",
      "500",
      "502",
      "503",
      "504",
      "524",
      "service.?unavailable",
      "server.?error",
      "internal.?error",
      // Wrapper/provider text for transient upstream failures, including OpenRouter
      // "Provider returned error" responses (#2264).
      "provider.?returned.?error",
      // Network, proxy, and fetch transport failures. This includes OpenAI Codex
      // raw-fetch failures such as "upstream connect", "connection refused", and
      // "reset before headers" (#733), plus OpenRouter connection drops (#3317).
      "network.?error",
      "connection.?error",
      "connection.?refused",
      "connection.?lost",
      "other side closed",
      "fetch failed",
      "getaddrinfo",
      "ENOTFOUND",
      "EAI_AGAIN",
      "upstream.?connect",
      "reset before headers",
      "socket hang up",
      "socket connection was closed",
      "timed? out",
      "timeout",
      "terminated",
      // WebSocket transports can report close/error text instead of HTTP/fetch text.
      "websocket.?closed",
      "websocket.?error",
      // Premature stream endings from SDKs and transports. Anthropic can throw
      // "stream ended without ..." and "Anthropic stream ended before message_stop"
      // (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
      "ended without",
      "stream ended before message_stop",
      "stream ended before a terminal response event",
      "http2 request did not get a response",
      // Provider-requested retry delay cap failures should flow through the outer
      // retry policy so callers can surface/abort the backoff (#1123).
      "retry delay",
      // Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
      // stream exceptions (#6019).
      "you can retry your request",
      "try your request again",
      "please retry your request",
      // gRPC based providers (e.g. NVIDIA NIM)
      "ResourceExhausted"
    ]);
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/typebox-helpers.js
var init_typebox_helpers = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/typebox-helpers.js"() {
    init_build();
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/uuid.js
function fillRandomBytes(bytes) {
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return;
  }
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
}
function uuidv7() {
  const random = new Uint8Array(16);
  fillRandomBytes(random);
  const timestamp = Date.now();
  if (timestamp > lastTimestamp) {
    sequence = random[6] * 16777216 + random[7] * 65536 + random[8] * 256 + random[9];
    lastTimestamp = timestamp;
  } else {
    sequence = sequence + 1 >>> 0;
    if (sequence === 0)
      lastTimestamp++;
  }
  const bytes = new Uint8Array(16);
  bytes[0] = lastTimestamp / 1099511627776 & 255;
  bytes[1] = lastTimestamp / 4294967296 & 255;
  bytes[2] = lastTimestamp / 16777216 & 255;
  bytes[3] = lastTimestamp / 65536 & 255;
  bytes[4] = lastTimestamp / 256 & 255;
  bytes[5] = lastTimestamp & 255;
  bytes[6] = 112 | sequence >>> 28 & 15;
  bytes[7] = sequence >>> 20 & 255;
  bytes[8] = 128 | sequence >>> 14 & 63;
  bytes[9] = sequence >>> 6 & 255;
  bytes[10] = (sequence & 63) << 2 | random[10] & 3;
  bytes[11] = random[11];
  bytes[12] = random[12];
  bytes[13] = random[13];
  bytes[14] = random[14];
  bytes[15] = random[15];
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
var lastTimestamp, sequence;
var init_uuid2 = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/uuid.js"() {
    lastTimestamp = -Infinity;
    sequence = 0;
  }
});

// node_modules/typebox/build/compile/code.mjs
var init_code = __esm({
  "node_modules/typebox/build/compile/code.mjs"() {
    init_arguments2();
    init_schema5();
  }
});

// node_modules/typebox/build/compile/validator.mjs
var init_validator = __esm({
  "node_modules/typebox/build/compile/validator.mjs"() {
    init_settings2();
    init_value2();
    init_schema5();
  }
});

// node_modules/typebox/build/compile/compile.mjs
var init_compile2 = __esm({
  "node_modules/typebox/build/compile/compile.mjs"() {
    init_arguments2();
    init_validator();
  }
});

// node_modules/typebox/build/compile/index.mjs
var init_compile3 = __esm({
  "node_modules/typebox/build/compile/index.mjs"() {
    init_code();
    init_compile2();
    init_validator();
    init_code();
    init_compile2();
    init_validator();
  }
});

// node_modules/@earendil-works/pi-ai/dist/utils/validation.js
var init_validation = __esm({
  "node_modules/@earendil-works/pi-ai/dist/utils/validation.js"() {
    init_compile3();
    init_value2();
  }
});

// node_modules/@earendil-works/pi-ai/dist/index.js
var init_dist2 = __esm({
  "node_modules/@earendil-works/pi-ai/dist/index.js"() {
    init_build();
    init_lazy();
    init_context2();
    init_credential_store();
    init_helpers2();
    init_types3();
    init_images_models();
    init_models();
    init_models_store();
    init_faux();
    init_session_resources();
    init_types4();
    init_diagnostics();
    init_event_stream();
    init_json_parse();
    init_overflow();
    init_retry();
    init_typebox_helpers();
    init_uuid2();
    init_validation();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/stream-fn.js
var init_stream_fn = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/stream-fn.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js
var init_agent_loop = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js"() {
    init_stream_fn();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/agent.js
var init_agent = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/agent.js"() {
    init_agent_loop();
    init_stream_fn();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/messages.js
function createBranchSummaryMessage(summary, fromId, timestamp) {
  return {
    role: "branchSummary",
    summary,
    fromId,
    timestamp: new Date(timestamp).getTime()
  };
}
function createCompactionSummaryMessage(summary, tokensBefore, timestamp) {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime()
  };
}
function createCustomMessage(customType, content, display, details, timestamp) {
  return {
    role: "custom",
    customType,
    content,
    display,
    details,
    timestamp: new Date(timestamp).getTime()
  };
}
var init_messages = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/messages.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/types.js
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}
function toError(error) {
  if (error instanceof Error)
    return error;
  if (typeof error === "string")
    return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}
var FileError, ExecutionError, SessionError;
var init_types5 = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/types.js"() {
    FileError = class extends Error {
      /** Backend-independent error code. */
      code;
      /** Absolute addressed path associated with the failure, when available. */
      path;
      constructor(code, message, path14, cause) {
        super(message, cause === void 0 ? void 0 : { cause });
        this.name = "FileError";
        this.code = code;
        this.path = path14;
      }
    };
    ExecutionError = class extends Error {
      /** Backend-independent error code. */
      code;
      constructor(code, message, cause) {
        super(message, cause === void 0 ? void 0 : { cause });
        this.name = "ExecutionError";
        this.code = code;
      }
    };
    SessionError = class extends Error {
      /** Session subsystem error code. */
      code;
      constructor(code, message, cause) {
        super(message, cause === void 0 ? void 0 : { cause });
        this.name = "SessionError";
        this.code = code;
      }
    };
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/session/session.js
function deriveSessionContextState(pathEntries) {
  let thinkingLevel = "off";
  let model = null;
  let activeToolNames = null;
  for (const entry of pathEntries) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      model = { provider: entry.message.provider, modelId: entry.message.model };
    } else if (entry.type === "active_tools_change") {
      activeToolNames = [...entry.activeToolNames];
    }
  }
  return { thinkingLevel, model, activeToolNames };
}
function defaultContextEntryTransform(pathEntries) {
  let compaction = null;
  for (const entry of pathEntries) {
    if (entry.type === "compaction") {
      compaction = entry;
    }
  }
  if (!compaction) {
    return [...pathEntries];
  }
  const entries = [compaction];
  const compactionIdx = pathEntries.findIndex((entry) => entry.type === "compaction" && entry.id === compaction.id);
  if (compaction.retainedTail) {
    for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
      entries.push(pathEntries[i]);
    }
    return entries;
  }
  if (compaction.firstKeptEntryId) {
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      const entry = pathEntries[i];
      if (entry.id === compaction.firstKeptEntryId)
        foundFirstKept = true;
      if (foundFirstKept)
        entries.push(entry);
    }
  }
  for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
    entries.push(pathEntries[i]);
  }
  return entries;
}
function buildContextEntries(pathEntries, options = {}) {
  let entries = defaultContextEntryTransform(pathEntries);
  for (const transform of options.entryTransforms ?? []) {
    entries = [...transform(entries)];
  }
  return entries;
}
function sessionEntryToContextMessages(entry, index, entries, options = {}) {
  if (entry.type === "message") {
    return [entry.message];
  }
  if (entry.type === "custom_message") {
    return [
      createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp)
    ];
  }
  if (entry.type === "compaction") {
    return [
      createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
      ...entry.retainedTail ?? []
    ];
  }
  if (entry.type === "branch_summary" && entry.summary) {
    return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
  }
  if (entry.type === "custom") {
    return [...options.entryProjectors?.[entry.customType]?.(entry, index, entries) ?? []];
  }
  return [];
}
function buildSessionContext(pathEntries, options = {}) {
  const state = deriveSessionContextState(pathEntries);
  const contextEntries = buildContextEntries(pathEntries, options);
  const messages = contextEntries.flatMap((entry, index) => sessionEntryToContextMessages(entry, index, contextEntries, options));
  return { ...state, messages };
}
var Session;
var init_session = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/session/session.js"() {
    init_messages();
    init_types5();
    Session = class {
      storage;
      contextBuildOptions;
      constructor(storage, contextBuildOptions = {}) {
        this.storage = storage;
        this.contextBuildOptions = contextBuildOptions;
      }
      getMetadata() {
        return this.storage.getMetadata();
      }
      getStorage() {
        return this.storage;
      }
      getLeafId() {
        return this.storage.getLeafId();
      }
      getEntry(id) {
        return this.storage.getEntry(id);
      }
      getEntries(options) {
        return this.storage.getEntries(options);
      }
      async getBranch(fromId) {
        const leafId = fromId ?? await this.storage.getLeafId();
        return this.storage.getPathToRootOrCompaction(leafId);
      }
      async buildContextEntries(options = {}) {
        return buildContextEntries(await this.getBranch(), this.mergeContextBuildOptions(options));
      }
      async buildContext(options = {}) {
        return buildSessionContext(await this.getBranch(), this.mergeContextBuildOptions(options));
      }
      mergeContextBuildOptions(options) {
        return {
          entryTransforms: [...this.contextBuildOptions.entryTransforms ?? [], ...options.entryTransforms ?? []],
          entryProjectors: {
            ...this.contextBuildOptions.entryProjectors ?? {},
            ...options.entryProjectors ?? {}
          }
        };
      }
      getLabel(id) {
        return this.storage.getLabel(id);
      }
      getSessionStats() {
        return this.storage.getSessionStats();
      }
      async getSessionName() {
        return this.storage.getSessionName();
      }
      async appendTypedEntry(entry) {
        await this.storage.appendEntry(entry);
        return entry.id;
      }
      async appendMessage(message) {
        return this.appendTypedEntry({
          type: "message",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          message
        });
      }
      async appendThinkingLevelChange(thinkingLevel) {
        return this.appendTypedEntry({
          type: "thinking_level_change",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          thinkingLevel
        });
      }
      async appendModelChange(provider, modelId) {
        return this.appendTypedEntry({
          type: "model_change",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          provider,
          modelId
        });
      }
      async appendActiveToolsChange(activeToolNames) {
        return this.appendTypedEntry({
          type: "active_tools_change",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          activeToolNames: [...activeToolNames]
        });
      }
      async appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage, retainedTail) {
        return this.appendTypedEntry({
          type: "compaction",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          summary,
          firstKeptEntryId,
          tokensBefore,
          retainedTail,
          details,
          usage,
          fromHook
        });
      }
      async appendCustomEntry(customType, data) {
        return this.appendTypedEntry({
          type: "custom",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          customType,
          data
        });
      }
      async appendCustomMessageEntry(customType, content, display, details) {
        return this.appendTypedEntry({
          type: "custom_message",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          customType,
          content,
          display,
          details
        });
      }
      async appendLabel(targetId, label) {
        if (!await this.storage.getEntry(targetId)) {
          throw new SessionError("not_found", `Entry ${targetId} not found`);
        }
        return this.appendTypedEntry({
          type: "label",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          targetId,
          label
        });
      }
      async appendSessionName(name) {
        const sanitizedName = name.replace(/[\r\n]+/g, " ").trim();
        return this.appendTypedEntry({
          type: "session_info",
          id: await this.storage.createEntryId(),
          parentId: await this.storage.getLeafId(),
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          name: sanitizedName
        });
      }
      async moveTo(entryId, summary) {
        if (entryId !== null && !await this.storage.getEntry(entryId)) {
          throw new SessionError("not_found", `Entry ${entryId} not found`);
        }
        await this.storage.setLeafId(entryId);
        if (!summary)
          return void 0;
        return this.appendTypedEntry({
          type: "branch_summary",
          id: await this.storage.createEntryId(),
          parentId: entryId,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          fromId: entryId ?? "root",
          summary: summary.summary,
          details: summary.details,
          usage: summary.usage,
          fromHook: summary.fromHook
        });
      }
    };
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/utils.js
var init_utils = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/utils.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js
var init_compaction = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js"() {
    init_messages();
    init_session();
    init_types5();
    init_utils();
    init_utils();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/branch-summarization.js
var init_branch_summarization = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/branch-summarization.js"() {
    init_messages();
    init_types5();
    init_compaction();
    init_utils();
  }
});

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports2) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports2.ALIAS = ALIAS;
    exports2.DOC = DOC;
    exports2.MAP = MAP;
    exports2.NODE_TYPE = NODE_TYPE;
    exports2.PAIR = PAIR;
    exports2.SCALAR = SCALAR;
    exports2.SEQ = SEQ;
    exports2.hasAnchor = hasAnchor;
    exports2.isAlias = isAlias;
    exports2.isCollection = isCollection;
    exports2.isDocument = isDocument;
    exports2.isMap = isMap;
    exports2.isNode = isNode;
    exports2.isPair = isPair;
    exports2.isScalar = isScalar;
    exports2.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path14) {
      const ctrl = callVisitor(key, node, visitor, path14);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path14, ctrl);
        return visit_(key, ctrl, visitor, path14);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path14 = Object.freeze(path14.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path14);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path14 = Object.freeze(path14.concat(node));
          const ck = visit_("key", node.key, visitor, path14);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path14);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path14) {
      const ctrl = await callVisitor(key, node, visitor, path14);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path14, ctrl);
        return visitAsync_(key, ctrl, visitor, path14);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path14 = Object.freeze(path14.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path14);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path14 = Object.freeze(path14.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path14);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path14);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path14) {
      if (typeof visitor === "function")
        return visitor(key, node, path14);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path14);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path14);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path14);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path14);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path14);
      return void 0;
    }
    function replaceNode(key, path14, node) {
      const parent = path14[path14.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports2.visit = visit;
    exports2.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports2.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports2.anchorIsValid = anchorIsValid;
    exports2.anchorNames = anchorNames;
    exports2.createNodeAnchors = createNodeAnchors;
    exports2.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports2) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports2.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports2.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports2) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports2.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports2.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports2.Scalar = Scalar;
    exports2.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports2.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path14, value) {
      let v = value;
      for (let i = path14.length - 1; i >= 0; --i) {
        const k = path14[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path14) => path14 == null || typeof path14 === "object" && !!path14[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path14, value) {
        if (isEmptyPath(path14))
          this.add(value);
        else {
          const [key, ...rest] = path14;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path14) {
        const [key, ...rest] = path14;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path14, keepScalar) {
        const [key, ...rest] = path14;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path14) {
        const [key, ...rest] = path14;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path14, value) {
        const [key, ...rest] = path14;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports2.Collection = Collection;
    exports2.collectionFromPath = collectionFromPath;
    exports2.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports2) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports2.indentComment = indentComment;
    exports2.lineComment = lineComment;
    exports2.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports2) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports2.FOLD_BLOCK = FOLD_BLOCK;
    exports2.FOLD_FLOW = FOLD_FLOW;
    exports2.FOLD_QUOTED = FOLD_QUOTED;
    exports2.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports2.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports2.createStringifyContext = createStringifyContext;
    exports2.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports2.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports2) {
    "use strict";
    var node_process = require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports2.debug = debug;
    exports2.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports2.addMergeToJSMap = addMergeToJSMap;
    exports2.isMergeKey = isMergeKey;
    exports2.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports2) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports2.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports2.Pair = Pair;
    exports2.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports2.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports2) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type2) {
        const map = Type2 ? new Type2() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports2.YAMLMap = YAMLMap;
    exports2.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports2.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports2.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports2.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports2) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports2.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports2.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports2.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports2) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports2.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports2) {
    "use strict";
    var node_buffer = require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports2.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports2.createPairs = createPairs;
    exports2.pairs = pairs;
    exports2.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports2.YAMLOMap = YAMLOMap;
    exports2.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports2.falseTag = falseTag;
    exports2.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intBin = intBin;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports2.YAMLSet = YAMLSet;
    exports2.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports2.floatTime = floatTime;
    exports2.intTime = intTime;
    exports2.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports2.coreKnownTags = coreKnownTags;
    exports2.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports2.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports2.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path14, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path14, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path14) {
        if (Collection.isEmptyPath(path14)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path14) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path14, keepScalar) {
        if (Collection.isEmptyPath(path14))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path14, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path14) {
        if (Collection.isEmptyPath(path14))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path14) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path14, value) {
        if (Collection.isEmptyPath(path14)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path14), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path14, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports2.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports2) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports2.YAMLError = YAMLError;
    exports2.YAMLParseError = YAMLParseError;
    exports2.YAMLWarning = YAMLWarning;
    exports2.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports2) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports2.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports2) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports2.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports2) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports2.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports2.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports2) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports2.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports2) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports2.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports2) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports2.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports2.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports2.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports2.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + match[1];
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok2 = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok2 ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports2.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports2.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports2) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports2.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports2.composeEmptyNode = composeEmptyNode;
    exports2.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports2) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports2.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports2.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports2) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports2.createScalarToken = createScalarToken;
    exports2.resolveAsScalar = resolveAsScalar;
    exports2.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports2) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports2.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports2) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path14) => {
      let item = cst;
      for (const [field, index] of path14) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path14) => {
      const parent = visit.itemAtPath(cst, path14.slice(0, -1));
      const field = path14[path14.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path14, item, visitor) {
      let ctrl = visitor(item, path14);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path14.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path14);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path14) : ctrl;
    }
    exports2.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports2) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports2.createScalarToken = cstScalar.createScalarToken;
    exports2.resolveAsScalar = cstScalar.resolveAsScalar;
    exports2.setScalarValue = cstScalar.setScalarValue;
    exports2.stringify = cstStringify.stringify;
    exports2.visit = cstVisit.visit;
    exports2.BOM = BOM;
    exports2.DOCUMENT = DOCUMENT;
    exports2.FLOW_END = FLOW_END;
    exports2.SCALAR = SCALAR;
    exports2.isCollection = isCollection;
    exports2.isScalar = isScalar;
    exports2.prettyToken = prettyToken;
    exports2.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports2) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports2.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports2) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports2.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser2 = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports2.Parser = Parser2;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse3(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports2.parse = parse3;
    exports2.parseAllDocuments = parseAllDocuments;
    exports2.parseDocument = parseDocument;
    exports2.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/yaml/dist/index.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports2.Composer = composer.Composer;
    exports2.Document = Document.Document;
    exports2.Schema = Schema.Schema;
    exports2.YAMLError = errors.YAMLError;
    exports2.YAMLParseError = errors.YAMLParseError;
    exports2.YAMLWarning = errors.YAMLWarning;
    exports2.Alias = Alias.Alias;
    exports2.isAlias = identity.isAlias;
    exports2.isCollection = identity.isCollection;
    exports2.isDocument = identity.isDocument;
    exports2.isMap = identity.isMap;
    exports2.isNode = identity.isNode;
    exports2.isPair = identity.isPair;
    exports2.isScalar = identity.isScalar;
    exports2.isSeq = identity.isSeq;
    exports2.Pair = Pair.Pair;
    exports2.Scalar = Scalar.Scalar;
    exports2.YAMLMap = YAMLMap.YAMLMap;
    exports2.YAMLSeq = YAMLSeq.YAMLSeq;
    exports2.CST = cst;
    exports2.Lexer = lexer.Lexer;
    exports2.LineCounter = lineCounter.LineCounter;
    exports2.Parser = parser.Parser;
    exports2.parse = publicApi.parse;
    exports2.parseAllDocuments = publicApi.parseAllDocuments;
    exports2.parseDocument = publicApi.parseDocument;
    exports2.stringify = publicApi.stringify;
    exports2.visit = visit.visit;
    exports2.visitAsync = visit.visitAsync;
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/prompt-templates.js
var import_yaml;
var init_prompt_templates = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/prompt-templates.js"() {
    import_yaml = __toESM(require_dist2(), 1);
    init_types5();
  }
});

// node_modules/@earendil-works/pi-agent-core/node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/@earendil-works/pi-agent-core/node_modules/ignore/index.js"(exports2, module2) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.{0,2}\/|^\.{1,2}$/;
    var REGEX_TEST_TRAILING_SLASH = /\/$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range) => range.replace(
      REGEX_REGEXP_RANGE,
      (match, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match : EMPTY
    );
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\?\s+)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?)\s/g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*\\\*\\\*\\\//,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${sanitizeRange(range)}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match) => /\/$/.test(match) ? `${match}$` : `${match}(?=$|\\/$)`
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\\\*$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var makeRegexPrefix = (pattern) => REPLACERS.reduce(
      (prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)),
      pattern
    );
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        );
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path14, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule[mode].test(path14);
          if (!matched) {
            return;
          }
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? UNDEFINED : rule;
        });
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path14, originalPath, doThrow) => {
      if (!isString(path14)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path14) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path14)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path14) => REGEX_TEST_INVALID_PATH.test(path14);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored, slices) {
        const path14 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path14,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path14, cache, checkUnignored, slices);
      }
      checkIgnore(path14) {
        if (!REGEX_TEST_TRAILING_SLASH.test(path14)) {
          return this.test(path14);
        }
        const slices = path14.split(SLASH).filter(Boolean);
        slices.pop();
        if (slices.length) {
          const parent = this._t(
            slices.join(SLASH) + SLASH,
            this._testCache,
            true,
            slices
          );
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path14, false, MODE_CHECK_IGNORE);
      }
      _t(path14, cache, checkUnignored, slices) {
        if (path14 in cache) {
          return cache[path14];
        }
        if (!slices) {
          slices = path14.split(SLASH).filter(Boolean);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path14] = this._rules.test(path14, checkUnignored, MODE_IGNORE);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path14] = parent.ignored ? parent : this._rules.test(path14, checkUnignored, MODE_IGNORE);
      }
      ignores(path14) {
        return this._test(path14, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path14) => !this.ignores(path14);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path14) {
        return this._test(path14, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path14) => checkPath(path14 && checkPath.convert(path14), path14, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path14) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path14) || isNotRelative(path14);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module2.exports = factory;
    factory.default = factory;
    module2.exports.isPathValid = isPathValid;
    define(module2.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/skills.js
var import_ignore, import_yaml2;
var init_skills = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/skills.js"() {
    import_ignore = __toESM(require_ignore(), 1);
    import_yaml2 = __toESM(require_dist2(), 1);
    init_types5();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.js
var init_agent_harness = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.js"() {
    init_agent_loop();
    init_branch_summarization();
    init_compaction();
    init_messages();
    init_prompt_templates();
    init_skills();
    init_types5();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/session/repo-utils.js
function createSessionId() {
  return uuidv7();
}
function createTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function toSession(storage) {
  return new Session(storage);
}
function getFileSystemResultOrThrow(result, message) {
  if (!result.ok) {
    const code = result.error.code === "not_found" ? "not_found" : "storage";
    throw new SessionError(code, `${message}: ${result.error.message}`, result.error);
  }
  return result.value;
}
async function getEntriesToFork(storage, options) {
  if (!options.entryId)
    return storage.getEntries();
  const target = await storage.getEntry(options.entryId);
  if (!target) {
    throw new SessionError("invalid_fork_target", `Entry ${options.entryId} not found`);
  }
  let effectiveLeafId;
  if ((options.position ?? "before") === "at") {
    effectiveLeafId = target.id;
  } else {
    if (target.type !== "message" || target.message.role !== "user") {
      throw new SessionError("invalid_fork_target", `Entry ${options.entryId} is not a user message`);
    }
    effectiveLeafId = target.parentId;
  }
  return storage.getPathToRootOrCompaction(effectiveLeafId);
}
var init_repo_utils = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/session/repo-utils.js"() {
    init_dist2();
    init_types5();
    init_session();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/session/jsonl-storage.js
function updateLabelCache(labelsById, entry) {
  if (entry.type !== "label")
    return;
  const label = entry.label?.trim();
  if (label) {
    labelsById.set(entry.targetId, label);
  } else {
    labelsById.delete(entry.targetId);
  }
}
function buildLabelsById(entries) {
  const labelsById = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}
function generateEntryId(byId) {
  for (let i = 0; i < 100; i++) {
    const id = uuidv7().slice(-8);
    if (!byId.has(id))
      return id;
  }
  return uuidv7();
}
function invalidSession(filePath, message, cause) {
  return new SessionError("invalid_session", `Invalid JSONL session file ${filePath}: ${message}`, cause);
}
function invalidEntry(filePath, lineNumber, message, cause) {
  return new SessionError("invalid_entry", `Invalid JSONL session file ${filePath}: line ${lineNumber} ${message}`, cause);
}
function parseHeaderLine(line, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSession(filePath, "first line is not a valid session header", toError(error));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidSession(filePath, "first line is not a valid session header");
  }
  const header = parsed;
  if (header.type !== "session")
    throw invalidSession(filePath, "first line is not a valid session header");
  if (header.version !== 3)
    throw invalidSession(filePath, "unsupported session version");
  if (typeof header.id !== "string" || !header.id)
    throw invalidSession(filePath, "session header is missing id");
  if (typeof header.timestamp !== "string" || !header.timestamp) {
    throw invalidSession(filePath, "session header is missing timestamp");
  }
  if (typeof header.cwd !== "string" || !header.cwd)
    throw invalidSession(filePath, "session header is missing cwd");
  if (header.parentSession !== void 0 && typeof header.parentSession !== "string") {
    throw invalidSession(filePath, "session header parentSession must be a string");
  }
  if (header.metadata !== void 0 && (typeof header.metadata !== "object" || header.metadata === null || Array.isArray(header.metadata))) {
    throw invalidSession(filePath, "session header metadata must be an object");
  }
  return {
    type: "session",
    version: 3,
    id: header.id,
    timestamp: header.timestamp,
    cwd: header.cwd,
    parentSession: header.parentSession,
    metadata: header.metadata
  };
}
function parseEntryLine(line, filePath, lineNumber) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidEntry(filePath, lineNumber, "is not valid JSON", toError(error));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidEntry(filePath, lineNumber, "is not a valid session entry");
  }
  const entry = parsed;
  if (typeof entry.type !== "string")
    throw invalidEntry(filePath, lineNumber, "is missing entry type");
  if (typeof entry.id !== "string" || !entry.id)
    throw invalidEntry(filePath, lineNumber, "is missing entry id");
  if (entry.parentId !== null && typeof entry.parentId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid parentId");
  }
  if (typeof entry.timestamp !== "string" || !entry.timestamp) {
    throw invalidEntry(filePath, lineNumber, "is missing timestamp");
  }
  if (entry.type === "leaf" && entry.targetId !== null && typeof entry.targetId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid targetId");
  }
  return entry;
}
function leafIdAfterEntry(entry) {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}
function headerToSessionMetadata(header, path14) {
  return {
    id: header.id,
    createdAt: header.timestamp,
    cwd: header.cwd,
    path: path14,
    parentSessionPath: header.parentSession,
    metadata: header.metadata
  };
}
async function loadJsonlSessionMetadata(fs, filePath) {
  const lines = getFileSystemResultOrThrow(await fs.readTextLines(filePath, { maxLines: 1 }), `Failed to read session header ${filePath}`);
  const line = lines[0];
  if (line?.trim())
    return headerToSessionMetadata(parseHeaderLine(line, filePath), filePath);
  throw invalidSession(filePath, "missing session header");
}
async function loadJsonlStorage(fs, filePath) {
  const content = getFileSystemResultOrThrow(await fs.readTextFile(filePath), `Failed to read session ${filePath}`);
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    throw invalidSession(filePath, "missing session header");
  }
  const header = parseHeaderLine(lines[0], filePath);
  const entries = [];
  let leafId = null;
  for (let i = 1; i < lines.length; i++) {
    const entry = parseEntryLine(lines[i], filePath, i + 1);
    entries.push(entry);
    leafId = leafIdAfterEntry(entry);
  }
  return { header, entries, leafId };
}
var JsonlSessionStorage;
var init_jsonl_storage = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/session/jsonl-storage.js"() {
    init_dist2();
    init_types5();
    init_repo_utils();
    JsonlSessionStorage = class _JsonlSessionStorage {
      fs;
      filePath;
      metadata;
      entries;
      byId;
      labelsById;
      currentLeafId;
      constructor(fs, filePath, header, entries, leafId) {
        this.fs = fs;
        this.filePath = filePath;
        this.metadata = headerToSessionMetadata(header, this.filePath);
        this.entries = entries;
        this.byId = new Map(entries.map((entry) => [entry.id, entry]));
        this.labelsById = buildLabelsById(entries);
        this.currentLeafId = leafId;
      }
      static async open(fs, filePath) {
        const loaded = await loadJsonlStorage(fs, filePath);
        return new _JsonlSessionStorage(fs, filePath, loaded.header, loaded.entries, loaded.leafId);
      }
      static async create(fs, filePath, options) {
        const header = {
          type: "session",
          version: 3,
          id: options.sessionId,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          cwd: options.cwd,
          parentSession: options.parentSessionPath,
          metadata: options.metadata
        };
        getFileSystemResultOrThrow(await fs.writeFile(filePath, `${JSON.stringify(header)}
`), `Failed to create session ${filePath}`);
        return new _JsonlSessionStorage(fs, filePath, header, [], null);
      }
      async getMetadata() {
        return this.metadata;
      }
      async getLeafId() {
        if (this.currentLeafId !== null && !this.byId.has(this.currentLeafId)) {
          throw new SessionError("invalid_session", `Entry ${this.currentLeafId} not found`);
        }
        return this.currentLeafId;
      }
      async setLeafId(leafId) {
        if (leafId !== null && !this.byId.has(leafId)) {
          throw new SessionError("not_found", `Entry ${leafId} not found`);
        }
        const entry = {
          type: "leaf",
          id: generateEntryId(this.byId),
          parentId: this.currentLeafId,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          targetId: leafId
        };
        getFileSystemResultOrThrow(await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}
`), `Failed to append session leaf ${entry.id}`);
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
        this.currentLeafId = leafId;
      }
      async createEntryId() {
        return generateEntryId(this.byId);
      }
      async appendEntry(entry) {
        getFileSystemResultOrThrow(await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}
`), `Failed to append session entry ${entry.id}`);
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
        updateLabelCache(this.labelsById, entry);
        this.currentLeafId = leafIdAfterEntry(entry);
      }
      async getEntry(id) {
        return this.byId.get(id);
      }
      async findEntries(type) {
        return this.entries.filter((entry) => entry.type === type);
      }
      async getLabel(id) {
        return this.labelsById.get(id);
      }
      async getSessionName() {
        const entries = await this.findEntries("session_info");
        return entries[entries.length - 1]?.name?.trim() || void 0;
      }
      async getSessionStats() {
        let messageCount = 0;
        let cachedTokens = 0;
        let uncachedTokens = 0;
        let totalTokens = 0;
        let costTotal = 0;
        for (const entry of this.entries) {
          if (entry.type === "message") {
            messageCount += 1;
          }
          const usage = entry.type === "message" ? entry.message.role === "assistant" ? entry.message.usage : void 0 : entry.type === "compaction" || entry.type === "branch_summary" ? entry.usage : void 0;
          if (!usage || typeof usage.input !== "number" || typeof usage.output !== "number" || typeof usage.cacheRead !== "number" || typeof usage.cacheWrite !== "number" || typeof usage.cost?.total !== "number") {
            continue;
          }
          cachedTokens += usage.cacheRead;
          uncachedTokens += usage.input + usage.cacheWrite;
          totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
          costTotal += usage.cost.total;
        }
        return {
          messageCount,
          cachedTokens,
          uncachedTokens,
          totalTokens,
          costTotal
        };
      }
      async getPathToRootOrCompaction(leafId) {
        if (leafId === null)
          return [];
        const path14 = [];
        let stopAtEntryId = null;
        let current = this.byId.get(leafId);
        if (!current)
          throw new SessionError("not_found", `Entry ${leafId} not found`);
        while (current) {
          path14.unshift(current);
          if (stopAtEntryId !== null && current.id === stopAtEntryId)
            break;
          if (current.type === "compaction") {
            if (current.retainedTail)
              break;
            stopAtEntryId = current.firstKeptEntryId ?? null;
          }
          if (!current.parentId)
            break;
          const parent = this.byId.get(current.parentId);
          if (!parent)
            throw new SessionError("invalid_session", `Entry ${current.parentId} not found`);
          current = parent;
        }
        return path14;
      }
      async getEntries(options) {
        const start = options?.afterEntrySeq ?? 0;
        const end = options?.limit === void 0 ? void 0 : start + options.limit;
        return this.entries.slice(start, end);
      }
    };
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/session/jsonl-repo.js
function encodeCwd(cwd) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
var JsonlSessionRepo;
var init_jsonl_repo = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/session/jsonl-repo.js"() {
    init_types5();
    init_jsonl_storage();
    init_repo_utils();
    JsonlSessionRepo = class {
      fs;
      sessionsRootInput;
      sessionsRoot;
      constructor(options) {
        this.fs = options.fs;
        this.sessionsRootInput = options.sessionsRoot;
      }
      async getSessionsRoot() {
        if (!this.sessionsRoot) {
          this.sessionsRoot = getFileSystemResultOrThrow(await this.fs.absolutePath(this.sessionsRootInput), `Failed to resolve sessions root ${this.sessionsRootInput}`);
        }
        return this.sessionsRoot;
      }
      async getSessionDir(cwd) {
        return getFileSystemResultOrThrow(await this.fs.joinPath([await this.getSessionsRoot(), encodeCwd(cwd)]), `Failed to resolve session directory for ${cwd}`);
      }
      async createSessionFilePath(cwd, sessionId, timestamp) {
        return getFileSystemResultOrThrow(await this.fs.joinPath([
          await this.getSessionDir(cwd),
          `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`
        ]), `Failed to resolve session file path for ${sessionId}`);
      }
      async create(options) {
        const id = options.id ?? createSessionId();
        const createdAt = createTimestamp();
        const sessionDir = await this.getSessionDir(options.cwd);
        getFileSystemResultOrThrow(await this.fs.createDir(sessionDir, { recursive: true }), `Failed to create session directory ${sessionDir}`);
        const filePath = await this.createSessionFilePath(options.cwd, id, createdAt);
        const storage = await JsonlSessionStorage.create(this.fs, filePath, {
          cwd: options.cwd,
          sessionId: id,
          parentSessionPath: options.parentSessionPath,
          metadata: options.metadata
        });
        return toSession(storage);
      }
      async open(metadata) {
        if (!getFileSystemResultOrThrow(await this.fs.exists(metadata.path), `Failed to check session ${metadata.path}`)) {
          throw new SessionError("not_found", `Session not found: ${metadata.path}`);
        }
        const storage = await JsonlSessionStorage.open(this.fs, metadata.path);
        return toSession(storage);
      }
      async list(options = {}) {
        const dirs = options.cwd ? [await this.getSessionDir(options.cwd)] : await this.listSessionDirs();
        const sessions = [];
        for (const dir of dirs) {
          if (!getFileSystemResultOrThrow(await this.fs.exists(dir), `Failed to check session directory ${dir}`)) {
            continue;
          }
          const files = getFileSystemResultOrThrow(await this.fs.listDir(dir), `Failed to list sessions in ${dir}`).filter((file) => file.kind !== "directory" && file.name.endsWith(".jsonl"));
          for (const file of files) {
            try {
              sessions.push(await loadJsonlSessionMetadata(this.fs, file.path));
            } catch (error) {
              const cause = toError(error);
              if (!(cause instanceof SessionError) || cause.code !== "invalid_session")
                throw cause;
            }
          }
        }
        sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return sessions;
      }
      async delete(metadata) {
        getFileSystemResultOrThrow(await this.fs.remove(metadata.path, { force: true }), `Failed to delete session ${metadata.path}`);
      }
      async fork(sourceMetadata, options) {
        const source = await this.open(sourceMetadata);
        const forkedEntries = await getEntriesToFork(source.getStorage(), options);
        const id = options.id ?? createSessionId();
        const createdAt = createTimestamp();
        const sessionDir = await this.getSessionDir(options.cwd);
        getFileSystemResultOrThrow(await this.fs.createDir(sessionDir, { recursive: true }), `Failed to create session directory ${sessionDir}`);
        const storage = await JsonlSessionStorage.create(this.fs, await this.createSessionFilePath(options.cwd, id, createdAt), {
          cwd: options.cwd,
          sessionId: id,
          parentSessionPath: options.parentSessionPath ?? sourceMetadata.path,
          metadata: options.metadata ?? sourceMetadata.metadata
        });
        for (const entry of forkedEntries) {
          await storage.appendEntry(entry);
        }
        return toSession(storage);
      }
      async listSessionDirs() {
        const sessionsRoot = await this.getSessionsRoot();
        if (!getFileSystemResultOrThrow(await this.fs.exists(sessionsRoot), `Failed to check sessions root ${sessionsRoot}`)) {
          return [];
        }
        const entries = getFileSystemResultOrThrow(await this.fs.listDir(sessionsRoot), `Failed to list sessions root ${sessionsRoot}`);
        return entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path);
      }
    };
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/session/memory-storage.js
var init_memory_storage = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/session/memory-storage.js"() {
    init_types5();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/session/memory-repo.js
var init_memory_repo = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/session/memory-repo.js"() {
    init_types5();
    init_memory_storage();
    init_repo_utils();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/system-prompt.js
var init_system_prompt = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/system-prompt.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/utils/truncate.js
var DEFAULT_MAX_BYTES, runtimeBuffer;
var init_truncate = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/utils/truncate.js"() {
    DEFAULT_MAX_BYTES = 50 * 1024;
    runtimeBuffer = globalThis.Buffer;
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/utils/shell-output.js
var init_shell_output = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/utils/shell-output.js"() {
    init_types5();
    init_truncate();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/bash.js
var MAX_TIMEOUT_SECONDS, bashSchema;
var init_bash = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/bash.js"() {
    init_build();
    init_types5();
    init_shell_output();
    init_truncate();
    MAX_TIMEOUT_SECONDS = 2147483647 / 1e3;
    bashSchema = typebox_exports.Object({
      command: typebox_exports.String({ description: "Bash command to execute" }),
      timeout: typebox_exports.Optional(typebox_exports.Number({ description: "Timeout in seconds (optional, no default timeout)" }))
    });
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/edit-diff.js
var init_edit_diff = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/edit-diff.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/file-mutation-queue.js
var init_file_mutation_queue = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/file-mutation-queue.js"() {
    init_types5();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/path-utils.js
var init_path_utils = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/path-utils.js"() {
    init_types5();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/edit.js
var replaceEditSchema, editSchema;
var init_edit2 = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/edit.js"() {
    init_build();
    init_edit_diff();
    init_file_mutation_queue();
    init_path_utils();
    replaceEditSchema = typebox_exports.Object({
      oldText: typebox_exports.String({
        description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."
      }),
      newText: typebox_exports.String({ description: "Replacement text for this targeted edit." })
    }, {});
    editSchema = typebox_exports.Object({
      path: typebox_exports.String({ description: "Path to the file to edit (relative or absolute)" }),
      edits: typebox_exports.Array(replaceEditSchema, {
        description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."
      })
    }, {});
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/image.js
var init_image = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/image.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/read.js
var readSchema;
var init_read = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/read.js"() {
    init_build();
    init_types5();
    init_truncate();
    init_image();
    init_path_utils();
    readSchema = typebox_exports.Object({
      path: typebox_exports.String({ description: "Path to the file to read (relative or absolute)" }),
      offset: typebox_exports.Optional(typebox_exports.Number({ description: "Line number to start reading from (1-indexed)" })),
      limit: typebox_exports.Optional(typebox_exports.Number({ description: "Maximum number of lines to read" }))
    });
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/write.js
var writeSchema;
var init_write = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/write.js"() {
    init_build();
    init_types5();
    init_file_mutation_queue();
    init_path_utils();
    writeSchema = typebox_exports.Object({
      path: typebox_exports.String({ description: "Path to the file to write (relative or absolute)" }),
      content: typebox_exports.String({ description: "Content to write to the file" })
    });
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/tools/index.js
var init_tools = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/tools/index.js"() {
    init_bash();
    init_edit2();
    init_read();
    init_write();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/proxy.js
var init_proxy = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/proxy.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/types.js
var init_types6 = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/types.js"() {
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/index.js
var init_dist3 = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/index.js"() {
    init_agent();
    init_agent_loop();
    init_agent_harness();
    init_branch_summarization();
    init_compaction();
    init_messages();
    init_prompt_templates();
    init_jsonl_repo();
    init_jsonl_storage();
    init_memory_repo();
    init_memory_storage();
    init_repo_utils();
    init_session();
    init_skills();
    init_system_prompt();
    init_tools();
    init_types5();
    init_shell_output();
    init_truncate();
    init_proxy();
    init_stream_fn();
    init_types6();
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/harness/env/nodejs.js
function resolveTimeoutMs(timeout) {
  if (timeout === void 0)
    return ok(void 0);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return err(new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"));
  }
  const timeoutMs = timeout * 1e3;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    return err(new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS2} seconds`));
  }
  return ok(timeoutMs);
}
function resolvePath(cwd, path14) {
  let normalized = path14;
  if (normalized === "~") {
    normalized = (0, import_node_os.homedir)();
  } else if (normalized.startsWith("~/") || process.platform === "win32" && normalized.startsWith("~\\")) {
    normalized = (0, import_node_path2.join)((0, import_node_os.homedir)(), normalized.slice(2));
  } else if (normalized.startsWith("file://")) {
    try {
      normalized = (0, import_node_url.fileURLToPath)(normalized);
    } catch {
    }
  }
  return (0, import_node_path2.isAbsolute)(normalized) ? (0, import_node_path2.resolve)(normalized) : (0, import_node_path2.resolve)(cwd, normalized);
}
function fileKindFromStats(stats) {
  if (stats.isFile())
    return "file";
  if (stats.isDirectory())
    return "directory";
  if (stats.isSymbolicLink())
    return "symlink";
  return void 0;
}
function fileInfoFromStats(path14, stats) {
  const kind = fileKindFromStats(stats);
  if (!kind)
    return err(new FileError("invalid", "Unsupported file type", path14));
  return ok({
    name: path14.replace(/\/+$/, "").split("/").pop() ?? path14,
    path: path14,
    kind,
    size: stats.size,
    mtimeMs: stats.mtimeMs
  });
}
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
function toFileError(error, path14) {
  if (error instanceof FileError)
    return error;
  const cause = toError(error);
  if (isNodeError(error)) {
    const message = error.message;
    switch (error.code) {
      case "ABORT_ERR":
        return new FileError("aborted", message, path14, cause);
      case "ENOENT":
        return new FileError("not_found", message, path14, cause);
      case "EACCES":
      case "EPERM":
        return new FileError("permission_denied", message, path14, cause);
      case "ENOTDIR":
        return new FileError("not_directory", message, path14, cause);
      case "EISDIR":
        return new FileError("is_directory", message, path14, cause);
      case "EINVAL":
        return new FileError("invalid", message, path14, cause);
    }
  }
  return new FileError("unknown", cause.message, path14, cause);
}
function abortResult(signal, path14) {
  return signal?.aborted ? err(new FileError("aborted", "aborted", path14)) : void 0;
}
async function pathExists(path14) {
  try {
    await (0, import_promises.access)(path14, import_node_fs2.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
async function runCommand(command, args, timeoutMs) {
  return await new Promise((resolve2) => {
    let stdout = "";
    let child;
    try {
      child = (0, import_node_child_process.spawn)(command, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      });
    } catch {
      resolve2({ stdout: "", status: null });
      return;
    }
    const timeout = setTimeout(() => {
      if (child.pid)
        killProcessTree(child.pid);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve2({ stdout: "", status: null });
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve2({ stdout, status });
    });
  });
}
async function findBashOnPath() {
  const result = process.platform === "win32" ? await runCommand("where", ["bash.exe"], 5e3) : await runCommand("which", ["bash"], 5e3);
  if (result.status !== 0 || !result.stdout)
    return null;
  const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
  return firstMatch && await pathExists(firstMatch) ? firstMatch : null;
}
function isLegacyWslBashPath(path14) {
  const normalized = path14.replace(/\//g, "\\").toLowerCase();
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}
function getBashShellConfig(shell) {
  return isLegacyWslBashPath(shell) ? { shell, args: ["-s"], commandTransport: "stdin" } : { shell, args: ["-c"] };
}
async function getShellConfig(customShellPath) {
  if (customShellPath) {
    if (await pathExists(customShellPath)) {
      return ok(getBashShellConfig(customShellPath));
    }
    return err(new ExecutionError("shell_unavailable", `Custom shell path not found: ${customShellPath}`));
  }
  if (process.platform === "win32") {
    const candidates = [];
    const programFiles = process.env.ProgramFiles;
    if (programFiles)
      candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    if (programFilesX86)
      candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return ok(getBashShellConfig(candidate));
      }
    }
    const bashOnPath2 = await findBashOnPath();
    if (bashOnPath2) {
      return ok(getBashShellConfig(bashOnPath2));
    }
    return err(new ExecutionError("shell_unavailable", `No bash shell found. Options:
  1. Install Git for Windows: https://git-scm.com/download/win
  2. Add your bash to PATH (Cygwin, MSYS2, etc.)
  3. Configure an explicit shellPath

Searched Git Bash in:
${candidates.map((path14) => `  ${path14}`).join("\n")}`));
  }
  if (await pathExists("/bin/bash")) {
    return ok(getBashShellConfig("/bin/bash"));
  }
  const bashOnPath = await findBashOnPath();
  if (bashOnPath) {
    return ok(getBashShellConfig(bashOnPath));
  }
  return ok({ shell: "sh", args: ["-c"] });
}
function getShellEnv(baseEnv, extraEnv, inheritEnv = true) {
  if (!inheritEnv)
    return { ...extraEnv };
  return {
    ...process.env,
    ...baseEnv,
    ...extraEnv
  };
}
function killProcessTree(pid) {
  if (process.platform === "win32") {
    try {
      (0, import_node_child_process.spawn)("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
        windowsHide: true
      });
    } catch {
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }
}
function waitForChildProcess(child) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let exited = false;
    let exitCode = null;
    let postExitTimer;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    const cleanup = () => {
      if (postExitTimer)
        clearTimeout(postExitTimer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };
    const finalize = (code) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolvePromise(code);
    };
    const maybeFinalizeAfterExit = () => {
      if (exited && stdoutEnded && stderrEnded)
        finalize(exitCode);
    };
    const armIdleTimer = () => {
      if (postExitTimer)
        clearTimeout(postExitTimer);
      postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
    };
    const onData = () => {
      if (exited && !settled)
        armIdleTimer();
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (error) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
      if (!settled)
        armIdleTimer();
    };
    const onClose = (code) => finalize(code);
    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}
var import_node_child_process, import_node_crypto2, import_node_fs2, import_promises, import_node_os, import_node_path2, import_node_readline, import_node_url, MAX_TIMEOUT_MS, MAX_TIMEOUT_SECONDS2, EXIT_STDIO_GRACE_MS, NodeExecutionEnv;
var init_nodejs = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/harness/env/nodejs.js"() {
    import_node_child_process = require("node:child_process");
    import_node_crypto2 = require("node:crypto");
    import_node_fs2 = require("node:fs");
    import_promises = require("node:fs/promises");
    import_node_os = require("node:os");
    import_node_path2 = require("node:path");
    import_node_readline = require("node:readline");
    import_node_url = require("node:url");
    init_types5();
    MAX_TIMEOUT_MS = 2147483647;
    MAX_TIMEOUT_SECONDS2 = MAX_TIMEOUT_MS / 1e3;
    EXIT_STDIO_GRACE_MS = 100;
    NodeExecutionEnv = class {
      cwd;
      shellPath;
      shellEnv;
      activeChildPids = /* @__PURE__ */ new Set();
      constructor(options) {
        this.cwd = options.cwd;
        this.shellPath = options.shellPath;
        this.shellEnv = options.shellEnv;
      }
      async absolutePath(path14) {
        return ok(resolvePath(this.cwd, path14));
      }
      async joinPath(parts) {
        return ok((0, import_node_path2.join)(...parts));
      }
      async exec(command, options) {
        if (options?.abortSignal?.aborted)
          return err(new ExecutionError("aborted", "aborted"));
        const timeoutMsResult = resolveTimeoutMs(options?.timeout);
        if (!timeoutMsResult.ok)
          return err(timeoutMsResult.error);
        const timeoutMs = timeoutMsResult.value;
        const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd;
        const shellConfig = await getShellConfig(this.shellPath);
        if (!shellConfig.ok)
          return shellConfig;
        try {
          await (0, import_promises.access)(cwd, import_node_fs2.constants.F_OK);
        } catch (error) {
          const cause = toError(error);
          return err(new ExecutionError("spawn_error", `Working directory does not exist: ${cwd}
Cannot execute bash commands.`, cause));
        }
        return await new Promise((resolvePromise) => {
          let stdout = "";
          let stderr = "";
          let settled = false;
          let timedOut = false;
          let callbackError;
          let child;
          let timeoutId;
          const onAbort = () => {
            if (child?.pid) {
              killProcessTree(child.pid);
            }
          };
          const settle = (result) => {
            if (timeoutId)
              clearTimeout(timeoutId);
            if (options?.abortSignal)
              options.abortSignal.removeEventListener("abort", onAbort);
            if (child?.pid)
              this.activeChildPids.delete(child.pid);
            if (settled)
              return;
            settled = true;
            resolvePromise(result);
          };
          try {
            const commandFromStdin = shellConfig.value.commandTransport === "stdin";
            child = (0, import_node_child_process.spawn)(shellConfig.value.shell, commandFromStdin ? shellConfig.value.args : [...shellConfig.value.args, command], {
              cwd,
              detached: process.platform !== "win32",
              env: getShellEnv(this.shellEnv, options?.env, options?.inheritEnv),
              stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
              windowsHide: true
            });
            if (child.pid)
              this.activeChildPids.add(child.pid);
            if (commandFromStdin) {
              child.stdin?.on("error", () => {
              });
              child.stdin?.end(command);
            }
          } catch (error) {
            const cause = toError(error);
            settle(err(new ExecutionError("spawn_error", cause.message, cause)));
            return;
          }
          timeoutId = timeoutMs !== void 0 ? setTimeout(() => {
            timedOut = true;
            if (child?.pid) {
              killProcessTree(child.pid);
            }
          }, timeoutMs) : void 0;
          if (options?.abortSignal) {
            if (options.abortSignal.aborted) {
              onAbort();
            } else {
              options.abortSignal.addEventListener("abort", onAbort, { once: true });
            }
          }
          child.stdout?.setEncoding("utf8");
          child.stderr?.setEncoding("utf8");
          child.stdout?.on("data", (chunk) => {
            stdout += chunk;
            try {
              options?.onStdout?.(chunk);
            } catch (error) {
              const cause = toError(error);
              callbackError = new ExecutionError("callback_error", cause.message, cause);
              onAbort();
            }
          });
          child.stderr?.on("data", (chunk) => {
            stderr += chunk;
            try {
              options?.onStderr?.(chunk);
            } catch (error) {
              const cause = toError(error);
              callbackError = new ExecutionError("callback_error", cause.message, cause);
              onAbort();
            }
          });
          void waitForChildProcess(child).then((code) => {
            if (callbackError) {
              settle(err(callbackError));
              return;
            }
            if (timedOut) {
              settle(err(new ExecutionError("timeout", `timeout:${options?.timeout}`)));
              return;
            }
            if (options?.abortSignal?.aborted) {
              settle(err(new ExecutionError("aborted", "aborted")));
              return;
            }
            settle(ok({ stdout, stderr, exitCode: code ?? 0 }));
          }, (error) => settle(err(new ExecutionError("spawn_error", error.message, error))));
        });
      }
      async readTextFile(path14, abortSignal) {
        const resolved = resolvePath(this.cwd, path14);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
          return aborted;
        try {
          return ok(await (0, import_promises.readFile)(resolved, { encoding: "utf8", signal: abortSignal }));
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async readTextLines(path14, options) {
        const resolved = resolvePath(this.cwd, path14);
        const aborted = abortResult(options?.abortSignal, resolved);
        if (aborted)
          return aborted;
        if (options?.maxLines !== void 0 && options.maxLines <= 0)
          return ok([]);
        let stream;
        let lineReader;
        try {
          stream = (0, import_node_fs2.createReadStream)(resolved, { encoding: "utf8", signal: options?.abortSignal });
          lineReader = (0, import_node_readline.createInterface)({ input: stream, crlfDelay: Infinity });
          const lines = [];
          for await (const line of lineReader) {
            const loopAbort = abortResult(options?.abortSignal, resolved);
            if (loopAbort)
              return loopAbort;
            lines.push(line);
            if (options?.maxLines !== void 0 && lines.length >= options.maxLines)
              break;
          }
          const afterReadAbort = abortResult(options?.abortSignal, resolved);
          if (afterReadAbort)
            return afterReadAbort;
          return ok(lines);
        } catch (error) {
          return err(toFileError(error, resolved));
        } finally {
          lineReader?.close();
          stream?.destroy();
        }
      }
      async readBinaryFile(path14, abortSignal) {
        const resolved = resolvePath(this.cwd, path14);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
          return aborted;
        try {
          return ok(await (0, import_promises.readFile)(resolved, { signal: abortSignal }));
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async writeFile(path14, content, abortSignal) {
        const resolved = resolvePath(this.cwd, path14);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
          return aborted;
        try {
          await (0, import_promises.mkdir)((0, import_node_path2.resolve)(resolved, ".."), { recursive: true });
          const afterMkdirAbort = abortResult(abortSignal, resolved);
          if (afterMkdirAbort)
            return afterMkdirAbort;
          await (0, import_promises.writeFile)(resolved, content, { signal: abortSignal });
          return ok(void 0);
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async appendFile(path14, content) {
        const resolved = resolvePath(this.cwd, path14);
        try {
          await (0, import_promises.mkdir)((0, import_node_path2.resolve)(resolved, ".."), { recursive: true });
          await (0, import_promises.appendFile)(resolved, content);
          return ok(void 0);
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async fileInfo(path14) {
        const resolved = resolvePath(this.cwd, path14);
        try {
          return fileInfoFromStats(resolved, await (0, import_promises.lstat)(resolved));
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async listDir(path14, abortSignal) {
        const resolved = resolvePath(this.cwd, path14);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
          return aborted;
        try {
          const entries = await (0, import_promises.readdir)(resolved, { withFileTypes: true });
          const infos = [];
          for (const entry of entries) {
            const loopAbort = abortResult(abortSignal, resolved);
            if (loopAbort)
              return loopAbort;
            const entryPath = (0, import_node_path2.resolve)(resolved, entry.name);
            try {
              const info = fileInfoFromStats(entryPath, await (0, import_promises.lstat)(entryPath));
              if (info.ok)
                infos.push(info.value);
            } catch (error) {
              return err(toFileError(error, entryPath));
            }
          }
          return ok(infos);
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async canonicalPath(path14) {
        const resolved = resolvePath(this.cwd, path14);
        try {
          return ok(await (0, import_promises.realpath)(resolved));
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async exists(path14) {
        const result = await this.fileInfo(path14);
        if (result.ok)
          return ok(true);
        if (result.error.code === "not_found")
          return ok(false);
        return err(result.error);
      }
      async createDir(path14, options) {
        const resolved = resolvePath(this.cwd, path14);
        try {
          await (0, import_promises.mkdir)(resolved, { recursive: options?.recursive ?? true });
          return ok(void 0);
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async remove(path14, options) {
        const resolved = resolvePath(this.cwd, path14);
        try {
          await (0, import_promises.rm)(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false });
          return ok(void 0);
        } catch (error) {
          return err(toFileError(error, resolved));
        }
      }
      async createTempDir(prefix = "tmp-") {
        try {
          return ok(await (0, import_promises.mkdtemp)((0, import_node_path2.join)((0, import_node_os.tmpdir)(), prefix)));
        } catch (error) {
          return err(toFileError(error));
        }
      }
      async createTempFile(options) {
        const dir = await this.createTempDir("tmp-");
        if (!dir.ok)
          return dir;
        const filePath = (0, import_node_path2.join)(dir.value, `${options?.prefix ?? ""}${(0, import_node_crypto2.randomUUID)()}${options?.suffix ?? ""}`);
        try {
          await (0, import_promises.writeFile)(filePath, "");
          return ok(filePath);
        } catch (error) {
          return err(toFileError(error, filePath));
        }
      }
      async cleanup() {
        for (const pid of this.activeChildPids)
          killProcessTree(pid);
        this.activeChildPids.clear();
      }
    };
  }
});

// node_modules/@earendil-works/pi-agent-core/dist/node.js
var init_node = __esm({
  "node_modules/@earendil-works/pi-agent-core/dist/node.js"() {
    init_nodejs();
    init_dist3();
  }
});

// packages/runtime/dist/session-store.js
var import_promises2, import_node_path3, PiJsonlSessionStore;
var init_session_store = __esm({
  "packages/runtime/dist/session-store.js"() {
    "use strict";
    init_dist3();
    init_node();
    import_promises2 = require("node:fs/promises");
    import_node_path3 = __toESM(require("node:path"), 1);
    PiJsonlSessionStore = class {
      repo;
      cwd;
      constructor(root) {
        this.cwd = import_node_path3.default.resolve(root);
        this.repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: this.cwd }), sessionsRoot: this.cwd });
      }
      async create(metadata = {}) {
        await (0, import_promises2.mkdir)(this.cwd, { recursive: true });
        return this.repo.create({ cwd: this.cwd, metadata });
      }
      async list() {
        return this.repo.list({ cwd: this.cwd });
      }
      async open(metadata) {
        return this.repo.open(metadata);
      }
    };
  }
});

// packages/runtime/dist/workspace.js
var import_promises3, import_node_path4, WorkspaceStore;
var init_workspace = __esm({
  "packages/runtime/dist/workspace.js"() {
    "use strict";
    import_promises3 = require("node:fs/promises");
    import_node_path4 = __toESM(require("node:path"), 1);
    WorkspaceStore = class {
      root;
      ownerUserId;
      ownerSessionId;
      constructor(root, ownership = {}) {
        this.root = import_node_path4.default.resolve(root);
        this.ownerUserId = ownership.userId;
        this.ownerSessionId = ownership.sessionId;
      }
      assertAccess(context) {
        if (this.ownerUserId && context.userId !== this.ownerUserId)
          throw new Error("WORKSPACE_OWNER_MISMATCH");
        if (this.ownerSessionId && context.sessionId !== this.ownerSessionId)
          throw new Error("WORKSPACE_SESSION_MISMATCH");
      }
      resolve(relativePath) {
        const target = import_node_path4.default.resolve(this.root, relativePath);
        if (target !== this.root && !target.startsWith(`${this.root}${import_node_path4.default.sep}`))
          throw new Error("WORKSPACE_PATH_ESCAPE");
        return target;
      }
      async list() {
        return (0, import_promises3.readdir)(this.root, { recursive: true });
      }
      async safeExisting(relativePath) {
        const target = await (0, import_promises3.realpath)(this.resolve(relativePath));
        const root = await (0, import_promises3.realpath)(this.root);
        if (target !== root && !target.startsWith(`${root}${import_node_path4.default.sep}`))
          throw new Error("WORKSPACE_SYMLINK_ESCAPE");
        return target;
      }
      async read(relativePath) {
        return (0, import_promises3.readFile)(await this.safeExisting(relativePath), "utf8");
      }
      async write(relativePath, content) {
        const target = this.resolve(relativePath);
        await (0, import_promises3.mkdir)(import_node_path4.default.dirname(target), { recursive: true });
        await (0, import_promises3.writeFile)(target, content, "utf8");
      }
      async delete(relativePath) {
        await (0, import_promises3.rm)(await this.safeExisting(relativePath), { force: true, recursive: true });
      }
      async upload(sourcePath, relativePath) {
        const target = this.resolve(relativePath);
        await (0, import_promises3.mkdir)(import_node_path4.default.dirname(target), { recursive: true });
        await (0, import_promises3.copyFile)(sourcePath, target);
        return this.artifact(relativePath);
      }
      async artifact(relativePath) {
        const info = await (0, import_promises3.stat)(await this.safeExisting(relativePath));
        return { path: relativePath, size: info.size, modifiedAt: info.mtimeMs, kind: "file" };
      }
    };
  }
});

// packages/runtime/dist/python-job.js
async function runPythonJob(code, options) {
  const jobId = (0, import_node_crypto3.randomUUID)();
  const started = Date.now();
  const scripts = import_node_path5.default.join(options.workspace, "scripts");
  await (0, import_promises4.mkdir)(scripts, { recursive: true });
  const scriptPath = import_node_path5.default.join(scripts, `${jobId}.py`);
  await (0, import_promises4.writeFile)(scriptPath, code, "utf8");
  return await new Promise((resolve2) => {
    const child = (0, import_node_child_process2.spawn)(options.executable, [scriptPath], { cwd: options.workspace, shell: false, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    let status = "error";
    const timer = setTimeout(() => {
      status = "timeout";
      child.kill();
    }, options.timeoutMs ?? 6e4);
    const abort = () => {
      status = "aborted";
      child.kill();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      (0, import_promises4.readdir)(options.workspace).then((artifacts) => resolve2({ jobId, status, exitCode: null, stdout, stderr: `${stderr}${error.message}`, scriptPath, artifacts, durationMs: Date.now() - started }));
    });
    child.on("close", (code2) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (status !== "timeout" && status !== "aborted")
        status = code2 === 0 ? "success" : "error";
      (0, import_promises4.readdir)(options.workspace).then((artifacts) => resolve2({ jobId, status, exitCode: code2, stdout, stderr, scriptPath, artifacts, durationMs: Date.now() - started }));
    });
  });
}
var import_node_child_process2, import_node_crypto3, import_promises4, import_node_path5;
var init_python_job = __esm({
  "packages/runtime/dist/python-job.js"() {
    "use strict";
    import_node_child_process2 = require("node:child_process");
    import_node_crypto3 = require("node:crypto");
    import_promises4 = require("node:fs/promises");
    import_node_path5 = __toESM(require("node:path"), 1);
  }
});

// packages/runtime/dist/knowledge.js
function tokenize(text) {
  const ascii = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  const bigrams = [];
  for (let i = 0; i < cjk.length - 1; i++)
    bigrams.push(cjk[i] + cjk[i + 1]);
  if (cjk.length === 1)
    bigrams.push(cjk[0]);
  return [...ascii, ...bigrams];
}
function splitChunks(text) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = [];
  let start = 1;
  let title = "";
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      chunks.push({ startLine: start, endLine: index, text: current.join("\n"), title });
      current = [];
      start = index + 1;
    }
    if (/^#\s/.test(line))
      title = line.replace(/^#\s+/, "");
    current.push(line);
  });
  if (current.length > 0)
    chunks.push({ startLine: start, endLine: lines.length, text: current.join("\n"), title });
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}
var import_promises5, import_node_fs3, import_node_path6, KnowledgeIndex;
var init_knowledge = __esm({
  "packages/runtime/dist/knowledge.js"() {
    "use strict";
    import_promises5 = require("node:fs/promises");
    import_node_fs3 = require("node:fs");
    import_node_path6 = __toESM(require("node:path"), 1);
    KnowledgeIndex = class {
      docs = /* @__PURE__ */ new Map();
      avgLength = () => {
        const all = [...this.docs.values()].flatMap((d) => d.chunks);
        return all.length === 0 ? 0 : all.reduce((sum, c) => sum + c.length, 0) / all.length;
      };
      async loadDirectory(root, base) {
        const baseRoot = base ?? root;
        if (!(0, import_node_fs3.existsSync)(root))
          return 0;
        let loaded = 0;
        for (const entry of await (0, import_promises5.readdir)(root, { withFileTypes: true })) {
          const full = import_node_path6.default.join(root, entry.name);
          if (entry.isDirectory())
            loaded += await this.loadDirectory(full, baseRoot);
          else if (entry.name.endsWith(".md")) {
            await this.loadFile(baseRoot, full);
            loaded += 1;
          }
        }
        return loaded;
      }
      async loadFile(root, filePath) {
        const relative = import_node_path6.default.relative(root, filePath).split(import_node_path6.default.sep).join("/");
        const text = await (0, import_promises5.readFile)(filePath, "utf8");
        const revision = this.hash(text);
        const category = relative.includes("/") ? relative.split("/")[0] : "doc";
        const chunks = splitChunks(text).map((chunk, index) => {
          const tokens = tokenize(chunk.text);
          const map = /* @__PURE__ */ new Map();
          for (const token of tokens)
            map.set(token, (map.get(token) ?? 0) + 1);
          return { chunkId: `${relative}#${index}`, title: chunk.title || import_node_path6.default.basename(filePath), startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.text, tokens: map, length: tokens.length };
        }).map((chunk) => ({ ...chunk, chunkId: `${chunk.chunkId}:${category}` }));
        this.docs.set(relative, { revision, chunks });
      }
      hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
          h ^= text.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return h >>> 0;
      }
      search(query, limit = 8) {
        const queryTokens = tokenize(query);
        const all = [...this.docs.entries()].flatMap(([relative, doc]) => doc.chunks.map((chunk) => ({ relative, doc, chunk })));
        if (all.length === 0)
          return [];
        const N = all.length;
        const avg = this.avgLength() || 1;
        const k1 = 1.5;
        const b = 0.75;
        const df = /* @__PURE__ */ new Map();
        for (const token of new Set(queryTokens)) {
          let count = 0;
          for (const { chunk } of all)
            if (chunk.tokens.has(token))
              count += 1;
          df.set(token, count);
        }
        const scored = [];
        for (const { relative, doc, chunk } of all) {
          let score = 0;
          for (const token of queryTokens) {
            const f = chunk.tokens.get(token) ?? 0;
            if (f === 0)
              continue;
            const idf = Math.log(1 + (N - (df.get(token) ?? 0) + 0.5) / ((df.get(token) ?? 0) + 0.5));
            score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (chunk.length / avg)));
          }
          if (score > 0) {
            const category = relative.includes("/") ? relative.split("/")[0] : "doc";
            scored.push({ path: relative, title: chunk.title, category, chunkId: chunk.chunkId.split(":").slice(0, 2).join(":"), startLine: chunk.startLine, endLine: chunk.endLine, score, revision: doc.revision });
          }
        }
        return scored.sort((a, z) => z.score - a.score).slice(0, limit);
      }
    };
  }
});

// packages/runtime/dist/clarification.js
var import_node_crypto4, ClarificationManager;
var init_clarification = __esm({
  "packages/runtime/dist/clarification.js"() {
    "use strict";
    import_node_crypto4 = require("node:crypto");
    ClarificationManager = class {
      defaultTimeoutMs;
      pending = /* @__PURE__ */ new Map();
      constructor(defaultTimeoutMs = 10 * 60 * 1e3) {
        this.defaultTimeoutMs = defaultTimeoutMs;
      }
      ask(sessionId, question, options, timeoutMs) {
        this.cancel(sessionId, "cancelled");
        const clarificationId = (0, import_node_crypto4.randomUUID)();
        let resolve2;
        const promise = new Promise((res) => {
          resolve2 = res;
        });
        const entry = { clarificationId, sessionId, question, options, resolve: resolve2 };
        entry.timer = setTimeout(() => {
          if (this.pending.get(clarificationId) !== entry)
            return;
          this.pending.delete(clarificationId);
          resolve2("");
          this.onSettled?.(clarificationId, "expired");
        }, timeoutMs ?? this.defaultTimeoutMs);
        this.pending.set(clarificationId, entry);
        this.onAsked?.({ clarificationId, sessionId, question, options });
        return { clarificationId, promise };
      }
      onSettled;
      onAsked;
      answer(clarificationId, answer) {
        const entry = this.pending.get(clarificationId);
        if (!entry)
          return false;
        clearTimeout(entry.timer);
        this.pending.delete(clarificationId);
        entry.resolve(answer);
        this.onSettled?.(clarificationId, "answered");
        return true;
      }
      cancel(sessionId, outcome = "cancelled") {
        for (const [id, entry] of [...this.pending.entries()]) {
          if (entry.sessionId === sessionId) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.resolve("");
            this.onSettled?.(id, outcome);
          }
        }
      }
      isPending(sessionId) {
        for (const entry of this.pending.values())
          if (entry.sessionId === sessionId)
            return true;
        return false;
      }
      /** Application restart: nothing survives process death. */
      dropAll() {
        for (const [id, entry] of [...this.pending.entries()]) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.resolve("");
          this.onSettled?.(id, "cancelled");
        }
      }
    };
  }
});

// packages/runtime/dist/dashboard-v3.js
function validateDashboardV3Spec(spec) {
  const errors = [];
  const s = spec;
  if (!s || typeof s !== "object")
    return { ok: false, errors: ["spec must be an object"] };
  if (typeof s.title !== "string" || !s.title)
    errors.push("title is required");
  if (!Array.isArray(s.datasets) || s.datasets.length === 0)
    errors.push("at least one dataset is required");
  else
    for (const d of s.datasets) {
      if (!d.id)
        errors.push("dataset.id is required");
      if (!Array.isArray(d.rows))
        errors.push(`dataset ${d.id} rows must be an array`);
    }
  if (!Array.isArray(s.views) || s.views.length === 0)
    errors.push("at least one view is required");
  else {
    const ids = new Set((s.datasets ?? []).map((d) => d.id));
    s.views.forEach((v, i) => {
      if (!["line", "bar", "pie", "kpi", "table"].includes(v.type))
        errors.push(`view ${i} has unsupported type`);
      if (v.dataset && !ids.has(v.dataset))
        errors.push(`view ${i} references unknown dataset ${v.dataset}`);
      if ((v.type === "line" || v.type === "bar") && (!v.xField || !v.yField))
        errors.push(`view ${i} needs xField/yField`);
      if (v.type === "pie" && (!v.nameField || !v.valueField))
        errors.push(`view ${i} needs nameField/valueField`);
      if (v.type === "kpi" && !v.field)
        errors.push(`view ${i} needs field`);
    });
  }
  return errors.length === 0 ? { ok: true, spec: s } : { ok: false, errors };
}
function aggregate(values, agg) {
  switch (agg) {
    case "avg":
      return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    case "count":
      return values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}
function seriesForView(view, dataset) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of dataset.rows) {
    const key = String(row[view.xField ?? ""] ?? "");
    const value = Number(row[view.yField ?? view.valueField ?? ""] ?? 0);
    if (!groups.has(key))
      groups.set(key, []);
    groups.get(key).push(value);
  }
  return [{ name: view.title ?? view.yField ?? view.valueField ?? "", points: [...groups.entries()].map(([name, values]) => ({ name, value: aggregate(values, view.aggregate) })) }];
}
function compileEChartsOptions(view, datasets) {
  const dataset = datasets.find((d) => d.id === view.dataset) ?? datasets[0];
  switch (view.type) {
    case "pie": {
      const data = dataset.rows.map((row) => ({ name: String(row[view.nameField] ?? ""), value: Number(row[view.valueField] ?? 0) }));
      return { title: { text: view.title }, series: [{ type: "pie", data }] };
    }
    case "kpi": {
      const values = dataset.rows.map((row) => Number(row[view.field] ?? 0));
      return { kpi: { label: view.title, value: aggregate(values, view.aggregate) } };
    }
    case "table":
      return { table: { columns: dataset.rows.length ? Object.keys(dataset.rows[0]) : [], rows: dataset.rows } };
    default: {
      const series = seriesForView(view, dataset)[0];
      return { xAxis: { data: series.points.map((p) => p.name) }, yAxis: {}, series: [{ name: series.name, type: view.type, data: series.points.map((p) => p.value) }] };
    }
  }
}
async function renderStandaloneDashboardHtml(spec, options = {}) {
  const charts = spec.views.map((view) => ({ viewId: view.id ?? view.title ?? view.type, options: compileEChartsOptions(view, spec.datasets) }));
  const payload = JSON.stringify({ title: spec.title, charts });
  let echartsScript = "";
  if (options.echartsAssetPath)
    echartsScript = `<script>${await (0, import_promises6.readFile)(options.echartsAssetPath, "utf8")}</script>`;
  else
    echartsScript = "<script>/* offline build requires bundled echarts asset */window.__DATA_AGENT_OFFLINE__=true;</script>";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${spec.title}</title></head>
<body><h1>${spec.title}</h1><div id="charts"></div>
${echartsScript}
<script>window.__DASHBOARD__=${payload};
(function(){
  var host=document.getElementById('charts');
  var hasEcharts=typeof window.echarts!=='undefined';
  window.__DASHBOARD__.charts.forEach(function(c){
    var el=document.createElement('div');el.style.width='600px';el.style.height='400px';host.appendChild(el);
    if(hasEcharts){var chart=window.echarts.init(el);chart.setOption(c.options.kpi?{title:{text:c.options.kpi.label,textAlign:'center',top:'40%'},series:[]}:c.options);}
    else{el.textContent=JSON.stringify(c.options);}
  });
})();
</script></body></html>`;
}
var import_promises6;
var init_dashboard_v3 = __esm({
  "packages/runtime/dist/dashboard-v3.js"() {
    "use strict";
    import_promises6 = require("node:fs/promises");
  }
});

// packages/runtime/dist/dashboard-v4.js
function validateDashboardV4Spec(spec) {
  const errors = [];
  const s = spec;
  if (!s || typeof s !== "object")
    return { ok: false, errors: ["spec must be an object"] };
  if (typeof s.title !== "string" || !s.title)
    errors.push("title is required");
  if (!Array.isArray(s.views) || s.views.length === 0)
    errors.push("at least one view is required");
  else
    for (const view of s.views) {
      if (!view.id)
        errors.push("view.id is required");
      if (!["line", "bar", "pie", "kpi", "table"].includes(view.type))
        errors.push(`view ${view.id} has unsupported type`);
      if (typeof view.query !== "string" || !view.query.trim())
        errors.push(`view ${view.id} needs a semantic query`);
    }
  return errors.length === 0 ? { ok: true, spec: s } : { ok: false, errors };
}
function renderSemanticDashboardHtml(spec, options) {
  const payload = JSON.stringify({ dashboardVersion: 4, title: spec.title, views: spec.views, parameters: spec.parameters ?? {}, nonce: options.nonce, expectedOrigin: options.expectedOrigin });
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${spec.title}</title></head>
<body><h1>${spec.title}</h1><div id="charts"></div>
<script>window.__SEMANTIC_DASHBOARD__=${payload};
(function(){
  var nonce=window.__SEMANTIC_DASHBOARD__.nonce;
  var hostOrigin=window.__SEMANTIC_DASHBOARD__.expectedOrigin;
  function send(msg){msg.nonce=nonce;window.parent.postMessage(msg,hostOrigin);}
  send({kind:'dashboard.ready'});
  window.addEventListener('message',function(ev){
    if(ev.origin!==hostOrigin)return;
    var d=ev.data||{};
    if(d.kind==='semantic.result'){document.title='updated:'+d.requestId;}
    if(d.kind==='semantic.error'){document.title='error:'+d.requestId;}
  });
})();
</script></body></html>`;
}
var init_dashboard_v4 = __esm({
  "packages/runtime/dist/dashboard-v4.js"() {
    "use strict";
  }
});

// packages/runtime/dist/auth.js
var import_node_crypto5, LocalAuthService;
var init_auth = __esm({
  "packages/runtime/dist/auth.js"() {
    "use strict";
    import_node_crypto5 = require("node:crypto");
    LocalAuthService = class {
      store;
      users = /* @__PURE__ */ new Map();
      tokens = /* @__PURE__ */ new Map();
      constructor(store) {
        this.store = store;
      }
      hash(password, salt) {
        return (0, import_node_crypto5.scryptSync)(password, salt, 32);
      }
      /** Number of registered accounts (0 ⇒ registration open for the first admin). */
      async userCount() {
        if (!this.store)
          return this.users.size;
        const result = await this.store.call("auth.userCount", "system");
        return Number(result?.count ?? 0);
      }
      async register(username, password, displayName = username) {
        if (!username || !password)
          throw new Error("AUTH_REGISTRATION_FAILED");
        if (!this.store) {
          if (this.users.has(username))
            throw new Error("AUTH_REGISTRATION_FAILED");
          const salt2 = (0, import_node_crypto5.randomBytes)(16);
          const user2 = { id: (0, import_node_crypto5.randomUUID)(), username, displayName };
          this.users.set(username, { user: user2, hash: this.hash(password, salt2), salt: salt2 });
          return user2;
        }
        if (await this.userCount() > 0)
          throw new Error("AUTH_REGISTRATION_CLOSED");
        const salt = (0, import_node_crypto5.randomBytes)(16);
        const user = { id: (0, import_node_crypto5.randomUUID)(), username, displayName };
        const result = await this.store.call("auth.register", "system", {
          username,
          userId: user.id,
          displayName,
          salt: salt.toString("hex"),
          hash: this.hash(password, salt).toString("hex")
        });
        if (!result?.ok)
          throw new Error(result?.reason ?? "AUTH_REGISTRATION_FAILED");
        return user;
      }
      async login(username, password) {
        if (!this.store) {
          const record = this.users.get(username);
          if (!record)
            throw new Error("AUTH_INVALID_CREDENTIALS");
          if (!(0, import_node_crypto5.timingSafeEqual)(this.hash(password, record.salt), record.hash))
            throw new Error("AUTH_INVALID_CREDENTIALS");
          const token2 = (0, import_node_crypto5.randomBytes)(32).toString("hex");
          this.tokens.set(token2, record.user);
          return { user: record.user, token: token2 };
        }
        const row = await this.store.call("auth.verify", "system", { username });
        if (!row)
          throw new Error("AUTH_INVALID_CREDENTIALS");
        const salt = Buffer.from(row.salt, "hex");
        if (!(0, import_node_crypto5.timingSafeEqual)(this.hash(password, salt), Buffer.from(row.hash, "hex")))
          throw new Error("AUTH_INVALID_CREDENTIALS");
        const user = { id: row.userId, username, displayName: row.displayName };
        const token = (0, import_node_crypto5.randomBytes)(32).toString("hex");
        await this.store.call("auth.token.set", "system", { token, userId: user.id, username: user.username, displayName: user.displayName });
        return { user, token };
      }
      async authenticate(token) {
        if (!token)
          return void 0;
        if (!this.store)
          return this.tokens.get(token);
        const row = await this.store.call("auth.token.get", "system", { token });
        return row ? { id: row.userId, username: row.username, displayName: row.displayName } : void 0;
      }
      async logout(token) {
        if (!this.store) {
          this.tokens.delete(token);
          return;
        }
        await this.store.call("auth.token.delete", "system", { token });
      }
    };
  }
});

// packages/runtime/dist/legacy-migration.js
function parseJson(value) {
  if (typeof value !== "string" || value.length === 0)
    return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
async function findFiles(root, name, result = []) {
  for (const entry of await (0, import_promises7.readdir)(root, { withFileTypes: true })) {
    const full = import_node_path7.default.join(root, entry.name);
    if (entry.isDirectory())
      await findFiles(full, name, result);
    else if (entry.name === name)
      result.push(full);
  }
  return result;
}
async function migrateLegacyData(sourceRoot, targetRoot, sessionStore) {
  const source = import_node_path7.default.resolve(sourceRoot);
  const target = import_node_path7.default.resolve(targetRoot);
  const marker = import_node_path7.default.join(target, ".migration-complete.json");
  try {
    return JSON.parse(await (0, import_promises7.readFile)(marker, "utf8"));
  } catch {
  }
  const migrationId = (0, import_node_crypto6.randomUUID)();
  const backupPath = import_node_path7.default.join(target, "migration-backup", migrationId);
  await (0, import_promises7.mkdir)(backupPath, { recursive: true });
  await (0, import_promises7.cp)(source, backupPath, { recursive: true, force: true });
  const report = { migrationId, migrated: 0, skipped: 0, warnings: [], backupPath };
  const databases = await findFiles(source, "app.sqlite3");
  for (const databasePath of databases) {
    let db;
    try {
      db = new import_better_sqlite3.default(databasePath, { readonly: true });
      const tasks = db.prepare("SELECT * FROM tasks").all();
      const sessions = db.prepare("SELECT * FROM chat_sessions").all();
      db.close();
      const destination = import_node_path7.default.join(target, "sessions", "legacy-metadata.json");
      await (0, import_promises7.mkdir)(import_node_path7.default.dirname(destination), { recursive: true });
      const projections = sessions.map((session) => ({ id: session.id, taskId: session.task_id, name: session.name, uiTranscript: parseJson(session.ui_transcript_json), contextMessages: parseJson(session.context_messages_json), activeSkills: parseJson(session.active_skills_json), attachedFiles: parseJson(session.attached_files_json), conversationVersion: session.conversation_version }));
      await (0, import_promises7.writeFile)(destination, JSON.stringify({ source: databasePath, tasks, sessions, projections }, null, 2), "utf8");
      if (sessionStore) {
        for (const projection of projections) {
          const session = await sessionStore.create({ legacySessionId: projection.id, taskId: projection.taskId });
          for (const message of Array.isArray(projection.contextMessages) ? projection.contextMessages : []) {
            if (message?.role === "user" || message?.role === "assistant" || message?.role === "toolResult")
              await session.appendMessage(message);
            else
              report.warnings.push(`Skipped unsupported legacy message in ${projection.id}`);
          }
        }
      }
      report.migrated += tasks.length + sessions.length;
    } catch (error) {
      report.skipped += 1;
      report.warnings.push(`Failed to migrate ${databasePath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        db?.close();
      } catch {
      }
    }
  }
  const snapshots = await findFiles(source, ".session_snapshot.json");
  for (const snapshot of snapshots) {
    try {
      const data = JSON.parse(await (0, import_promises7.readFile)(snapshot, "utf8"));
      const sessionId = typeof data.session_id === "string" ? data.session_id : import_node_path7.default.basename(import_node_path7.default.dirname(snapshot));
      const destination = import_node_path7.default.join(target, "sessions", `${sessionId}.legacy.json`);
      await (0, import_promises7.mkdir)(import_node_path7.default.dirname(destination), { recursive: true });
      await (0, import_promises7.writeFile)(destination, JSON.stringify({ legacy: true, source: snapshot, data }, null, 2), "utf8");
      report.migrated += 1;
    } catch (error) {
      report.skipped += 1;
      report.warnings.push(`Failed to migrate ${snapshot}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await (0, import_promises7.mkdir)(target, { recursive: true });
  await (0, import_promises7.writeFile)(marker, JSON.stringify(report, null, 2), "utf8");
  return report;
}
var import_promises7, import_node_path7, import_node_crypto6, import_better_sqlite3;
var init_legacy_migration = __esm({
  "packages/runtime/dist/legacy-migration.js"() {
    "use strict";
    import_promises7 = require("node:fs/promises");
    import_node_path7 = __toESM(require("node:path"), 1);
    import_node_crypto6 = require("node:crypto");
    import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
    init_session_store();
  }
});

// packages/runtime/dist/skills.js
var skills_exports = {};
__export(skills_exports, {
  effectiveTools: () => effectiveTools,
  loadSkillsFromDir: () => loadSkillsFromDir,
  moveSystemPrompt: () => moveSystemPrompt
});
async function loadSkillsFromDir(dir) {
  const skills = [];
  const diagnostics = [];
  let entries;
  try {
    entries = await (0, import_promises8.readdir)(dir, { withFileTypes: true });
  } catch {
    return { skills, diagnostics };
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    const filePath = import_node_path8.default.join(dir, entry.name, "SKILL.md");
    try {
      const raw = await (0, import_promises8.readFile)(filePath, "utf8");
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      if (!match) {
        diagnostics.push({ path: filePath, message: "missing frontmatter" });
        continue;
      }
      const name = /^name:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? entry.name;
      const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? "";
      const allowedTools = [...match[1].matchAll(/^\s*-\s*(\S+)\s*$/gm)].map((m) => m[1]);
      const unknown = allowedTools.filter((tool) => !CANONICAL_TOOLS.has(tool));
      if (unknown.length > 0)
        diagnostics.push({ path: filePath, message: `unknown tool names: ${unknown.join(", ")}` });
      skills.push({ name, description, filePath, allowedTools, content: raw });
    } catch (error) {
      diagnostics.push({ path: filePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { skills, diagnostics };
}
function effectiveTools(globalTools, activeSkills) {
  if (activeSkills.length === 0)
    return globalTools;
  const allowed = new Set(activeSkills.flatMap((skill) => skill.allowedTools));
  return globalTools.filter((tool) => allowed.has(tool));
}
async function moveSystemPrompt(agentMdPath, systemMdPath) {
  const { writeFile: writeFile9, rename: rename3, access: access3 } = await import("node:fs/promises");
  try {
    await access3(systemMdPath);
    return;
  } catch {
  }
  const content = await (0, import_promises8.readFile)(agentMdPath, "utf8");
  const { mkdir: mkdir9 } = await import("node:fs/promises");
  await mkdir9(import_node_path8.default.dirname(systemMdPath), { recursive: true });
  await writeFile9(systemMdPath, content, "utf8");
  await rename3(agentMdPath, `${agentMdPath}.migrated`);
}
var import_promises8, import_node_path8, CANONICAL_TOOLS;
var init_skills2 = __esm({
  "packages/runtime/dist/skills.js"() {
    "use strict";
    import_promises8 = require("node:fs/promises");
    import_node_path8 = __toESM(require("node:path"), 1);
    CANONICAL_TOOLS = /* @__PURE__ */ new Set([
      "list_workspace",
      "read_file",
      "write_file",
      "run_python",
      "search_knowledge",
      "read_knowledge",
      "update_knowledge",
      "load_skill",
      "generate_dashboard",
      "show_widget",
      "query_database",
      "ask_user_clarification",
      "export_query"
    ]);
  }
});

// packages/runtime/dist/knowledge-write.js
async function readAuditLog(auditPath) {
  try {
    return (await (0, import_promises9.readFile)(auditPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
var import_promises9, import_node_path9, import_node_crypto7, CANONICAL_DOCS, KnowledgeWriteDeniedError, KnowledgeWriter;
var init_knowledge_write = __esm({
  "packages/runtime/dist/knowledge-write.js"() {
    "use strict";
    import_promises9 = require("node:fs/promises");
    import_node_path9 = __toESM(require("node:path"), 1);
    import_node_crypto7 = require("node:crypto");
    CANONICAL_DOCS = ["doc/business.md", "doc/rules.md", "doc/query_patterns.md", ".pi/SYSTEM.md"];
    KnowledgeWriteDeniedError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "KnowledgeWriteDeniedError";
      }
    };
    KnowledgeWriter = class {
      root;
      auditPath;
      constructor(root, auditPath) {
        this.root = import_node_path9.default.resolve(root);
        this.auditPath = auditPath ?? import_node_path9.default.join(this.root, ".audit.log");
      }
      resolve(relativePath) {
        const target = import_node_path9.default.resolve(this.root, relativePath);
        if (!target.startsWith(`${this.root}${import_node_path9.default.sep}`) && target !== this.root)
          throw new Error("KNOWLEDGE_PATH_ESCAPE");
        return target;
      }
      assertAllowed(operation, relativePath) {
        const normalized = relativePath.split(import_node_path9.default.sep).join("/").replace(/^\.\//, "");
        if (normalized === "agent.md" || normalized.startsWith(".pi/"))
          throw new KnowledgeWriteDeniedError("SYSTEM_PROMPT_IMMUTABLE");
        if (CANONICAL_DOCS.includes(normalized) && operation !== "update_schema")
          throw new KnowledgeWriteDeniedError(`CANONICAL_WRITE_DENIED:${normalized}`);
        if (operation === "append_learning" && !normalized.startsWith("doc/learning"))
          throw new KnowledgeWriteDeniedError("LEARNING_APPEND_ONLY");
      }
      async write(operation, relativePath, content) {
        this.assertAllowed(operation, relativePath);
        const target = this.resolve(relativePath);
        await (0, import_promises9.mkdir)(import_node_path9.default.dirname(target), { recursive: true });
        if (operation === "append_learning") {
          let previous = "";
          try {
            previous = await (0, import_promises9.readFile)(target, "utf8");
          } catch {
          }
          await (0, import_promises9.writeFile)(target, previous + (previous.endsWith("\n") || previous === "" ? "" : "\n") + content + "\n", "utf8");
          await this.audit(operation, relativePath);
          return { operation, path: relativePath, bytesWritten: content.length };
        }
        const temp = `${target}.${(0, import_node_crypto7.randomUUID)()}.tmp`;
        await (0, import_promises9.writeFile)(temp, content, "utf8");
        await (0, import_promises9.rename)(temp, target);
        await this.audit(operation, relativePath);
        return { operation, path: relativePath, bytesWritten: (await (0, import_promises9.stat)(target)).size };
      }
      async audit(operation, relativePath) {
        await (0, import_promises9.mkdir)(import_node_path9.default.dirname(this.auditPath), { recursive: true });
        await (0, import_promises9.appendFile)(this.auditPath, `${JSON.stringify({ id: (0, import_node_crypto7.randomUUID)(), timestamp: Date.now(), operation, path: relativePath })}
`, "utf8");
      }
    };
  }
});

// packages/runtime/dist/export-adapter.js
function createExportQueryAdapter(options) {
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  return {
    assertCapability(capability) {
      if (!capability?.export || !capability?.resourceTransfer) {
        throw new ExportCapabilityError("EXPORT_NOT_SUPPORTED");
      }
    },
    async acceptResource(resource, relativePath) {
      if (!/\.csv$/i.test(new URL(resource.uri.replace(/^sqlite:\/\//, "http://")).pathname) && resource.mimeType !== "text/csv") {
        throw new ExportCapabilityError("EXPORT_MEDIA_TYPE_REJECTED");
      }
      const blob = Buffer.from(resource.blob, "base64");
      if (blob.byteLength > maxBytes)
        throw new ExportCapabilityError("EXPORT_TOO_LARGE");
      const sha256 = (0, import_node_crypto8.createHash)("sha256").update(blob).digest("hex");
      const filename = relativePath ?? `data/exports/${import_node_path10.default.basename(new URL(resource.uri.replace(/^sqlite:\/\//, "http://")).pathname)}`;
      const target = import_node_path10.default.resolve(options.workspace.root, filename);
      if (!target.startsWith(`${options.workspace.root}${import_node_path10.default.sep}`))
        throw new ExportCapabilityError("WORKSPACE_PATH_ESCAPE");
      await (0, import_promises10.mkdir)(import_node_path10.default.dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID8()}.tmp`;
      await (0, import_promises10.writeFile)(temp, blob);
      await (0, import_promises10.rename)(temp, target);
      return { path: import_node_path10.default.relative(options.workspace.root, target).split(import_node_path10.default.sep).join("/"), sha256, bytes: blob.byteLength };
    }
  };
}
function randomUUID8() {
  return crypto.randomUUID();
}
var import_node_crypto8, import_promises10, import_node_path10, ExportCapabilityError;
var init_export_adapter = __esm({
  "packages/runtime/dist/export-adapter.js"() {
    "use strict";
    import_node_crypto8 = require("node:crypto");
    import_promises10 = require("node:fs/promises");
    import_node_path10 = __toESM(require("node:path"), 1);
    ExportCapabilityError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "ExportCapabilityError";
      }
    };
  }
});

// packages/runtime/dist/process-supervisor.js
function semanticToolIdentity(serverName, toolName) {
  return `mcp__${serverName}__${toolName}`;
}
var import_node_child_process3, ProcessSupervisor;
var init_process_supervisor = __esm({
  "packages/runtime/dist/process-supervisor.js"() {
    "use strict";
    import_node_child_process3 = require("node:child_process");
    ProcessSupervisor = class {
      options;
      child;
      state = "stopped";
      listeners = /* @__PURE__ */ new Set();
      restarting = false;
      disposed = false;
      constructor(options) {
        this.options = options;
      }
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      getState() {
        return this.state;
      }
      getPid() {
        return this.child?.pid;
      }
      setState(state) {
        this.state = state;
        for (const listener of this.listeners)
          listener(state);
      }
      async start() {
        if (this.disposed)
          throw new Error("SUPERVISOR_DISPOSED");
        this.setState("starting");
        this.spawnChild();
        await new Promise((resolve2) => setTimeout(resolve2, 50));
        if (this.state === "failed")
          throw new Error(`PROCESS_FAILED:${this.options.name}`);
        this.setState("running");
      }
      spawnChild() {
        this.child = (0, import_node_child_process3.spawn)(this.options.command, this.options.args ?? [], { stdio: "ignore", windowsHide: true });
        this.child.on("error", () => this.handleExit());
        this.child.on("exit", () => this.handleExit());
      }
      handleExit() {
        if (this.disposed || this.restarting)
          return;
        if (this.options.maxRestarts !== void 0 && this.restartCount >= this.options.maxRestarts) {
          this.setState("failed");
          return;
        }
        this.restarting = true;
        this.setState("restarting");
        setTimeout(() => {
          this.restarting = false;
          this.restartCount += 1;
          this.spawnChild();
          this.setState("running");
        }, this.options.restartDelayMs ?? 100);
      }
      restartCount = 0;
      async stop() {
        this.disposed = true;
        const child = this.child;
        if (!child) {
          this.setState("stopped");
          return;
        }
        await new Promise((resolve2) => {
          child.once("exit", () => resolve2());
          try {
            child.kill();
          } catch {
            resolve2();
          }
          setTimeout(resolve2, 2e3);
        });
        this.setState("stopped");
      }
      /** Health probe hook reserved for real health endpoints (KTX /health). */
      isHealthy() {
        return this.state === "running" && (this.options.isHealthy ? this.options.isHealthy(this.child) : this.child?.exitCode === null);
      }
    };
  }
});

// packages/runtime/dist/providers.js
var import_node_crypto9, InMemorySecretVault, ProviderRegistry;
var init_providers = __esm({
  "packages/runtime/dist/providers.js"() {
    "use strict";
    import_node_crypto9 = require("node:crypto");
    InMemorySecretVault = class {
      store = /* @__PURE__ */ new Map();
      async encrypt(plain) {
        const id = (0, import_node_crypto9.randomUUID)();
        this.store.set(id, plain);
        return `mem:${id}`;
      }
      async decrypt(cipher) {
        if (!cipher.startsWith("mem:"))
          throw new Error("UNKNOWN_SECRET_FORMAT");
        return this.store.get(cipher.slice(4)) ?? "";
      }
    };
    ProviderRegistry = class {
      vault;
      profiles = /* @__PURE__ */ new Map();
      constructor(vault) {
        this.vault = vault;
      }
      async save(profile) {
        const id = profile.id ?? (0, import_node_crypto9.randomUUID)();
        let apiKey;
        if (profile.apiKey)
          apiKey = await this.vault.encrypt(profile.apiKey);
        const stored = { ...profile, id, apiKey };
        if (stored.isDefault)
          for (const p of this.profiles.values())
            p.isDefault = false;
        this.profiles.set(id, stored);
        return stored;
      }
      list() {
        return [...this.profiles.values()].map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: Boolean(apiKey) }));
      }
      async resolveForPi(id) {
        const profile = this.profiles.get(id);
        if (!profile)
          return void 0;
        return {
          provider: profile.provider === "anthropic" ? "anthropic" : "openai",
          model: profile.model,
          apiKey: profile.apiKey ? await this.vault.decrypt(profile.apiKey) : void 0
        };
      }
      getDefault() {
        return [...this.profiles.values()].find((p) => p.isDefault);
      }
    };
  }
});

// packages/runtime/dist/tools-catalog.js
function canonicalLocalTools() {
  return [
    { name: "list_workspace", identity: "list_workspace", origin: "local", description: "List files in the session workspace.", parameters: typebox_exports.Object({}) },
    { name: "read_file", identity: "read_file", origin: "local", description: "Read a workspace file.", parameters: typebox_exports.Object({ path: typebox_exports.String() }) },
    { name: "write_file", identity: "write_file", origin: "local", description: "Write a workspace file.", parameters: typebox_exports.Object({ path: typebox_exports.String(), content: typebox_exports.String() }) },
    { name: "run_python", identity: "run_python", origin: "local", description: "Execute Python analysis code in an isolated job.", parameters: typebox_exports.Object({ code: typebox_exports.String({ minLength: 1 }), description: typebox_exports.Optional(typebox_exports.String()) }) },
    { name: "search_knowledge", identity: "search_knowledge", origin: "local", description: "Search the Markdown knowledge base.", parameters: typebox_exports.Object({ query: typebox_exports.String({ minLength: 1 }) }) },
    { name: "read_knowledge", identity: "read_knowledge", origin: "local", description: "Read a knowledge document.", parameters: typebox_exports.Object({ path: typebox_exports.String({ minLength: 1 }) }) },
    { name: "update_knowledge", identity: "update_knowledge", origin: "local", description: "Append learning, write drafts, or update schema snapshots.", parameters: typebox_exports.Object({ operation: typebox_exports.Union([typebox_exports.Literal("append_learning"), typebox_exports.Literal("write_draft"), typebox_exports.Literal("update_schema")]), path: typebox_exports.String({ minLength: 1 }), content: typebox_exports.String() }) },
    { name: "load_skill", identity: "load_skill", origin: "local", description: "Load a discovered skill by name.", parameters: typebox_exports.Object({ name: typebox_exports.String({ minLength: 1 }) }) },
    { name: "generate_dashboard", identity: "generate_dashboard", origin: "local", description: "Validate, create or edit static/semantic dashboards.", parameters: typebox_exports.Object({ operation: typebox_exports.Union([typebox_exports.Literal("create"), typebox_exports.Literal("edit"), typebox_exports.Literal("validate")]), mode: typebox_exports.Union([typebox_exports.Literal("static"), typebox_exports.Literal("semantic")]), version: typebox_exports.Union([typebox_exports.Literal("v3"), typebox_exports.Literal("v4")]), spec: typebox_exports.Unknown(), editPath: typebox_exports.Optional(typebox_exports.String()) }) },
    { name: "show_widget", identity: "show_widget", origin: "local", description: "Render an inline UI widget card.", parameters: typebox_exports.Object({ kind: typebox_exports.Union([typebox_exports.Literal("kpi"), typebox_exports.Literal("chart"), typebox_exports.Literal("table"), typebox_exports.Literal("steps")]), spec: typebox_exports.Unknown() }) },
    { name: "query_database", identity: "query_database", origin: "mcp-dynamic", description: "Preview a read-only query through the database MCP server.", parameters: typebox_exports.Object({ sql: typebox_exports.String({ minLength: 1 }), limit: typebox_exports.Optional(typebox_exports.Number()) }) },
    { name: "ask_user_clarification", identity: "ask_user_clarification", origin: "local", description: "Ask the user a structured clarifying question.", parameters: typebox_exports.Object({ question: typebox_exports.String({ minLength: 1 }), options: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String())) }) },
    { name: "export_query", identity: "mcp__database__export_query", origin: "mcp-dynamic", description: "Export full query results as a CSV artifact via MCP Resource transfer.", parameters: typebox_exports.Object({ sql: typebox_exports.String({ minLength: 1 }), filename: typebox_exports.Optional(typebox_exports.String()) }) }
  ];
}
function assertNoLegacyTools(names) {
  const offenders = [...names].filter((name) => FORBIDDEN_LEGACY.has(name));
  if (offenders.length > 0)
    throw new Error(`LEGACY_TOOL_NAMES_PRESENT:${offenders.join(",")}`);
}
var FORBIDDEN_LEGACY;
var init_tools_catalog = __esm({
  "packages/runtime/dist/tools-catalog.js"() {
    "use strict";
    init_build();
    FORBIDDEN_LEGACY = /* @__PURE__ */ new Set([
      "execute_sql",
      "export_sql_to_csv",
      "read_workspace_file",
      "write_workspace_file",
      "validate_dashboard_spec",
      "build_dashboard",
      "edit_dashboard",
      "validate_semantic_dashboard_spec",
      "build_semantic_dashboard",
      "search_query_patterns",
      "search_business_context",
      "grep_context",
      "search_column_metadata",
      "save_column_metadata",
      "search_past_learnings",
      "save_learning",
      "report_query_feedback",
      "activate_skill",
      "tool_search",
      "call_webhook"
    ]);
  }
});

// packages/runtime/dist/python-runtime.js
async function probePython(executable) {
  try {
    await (0, import_promises11.access)(executable);
    return true;
  } catch {
    return false;
  }
}
async function loadRuntimeManifest(runtimeRoot) {
  return JSON.parse(await (0, import_promises11.readFile)(import_node_path11.default.join(runtimeRoot, "manifest.json"), "utf8"));
}
async function resolvePythonRuntime(external, bundled, manifest) {
  if (external && await probePython(external))
    return { mode: "external", executable: external };
  return { mode: "bundled", executable: bundled, manifest };
}
var import_promises11, import_node_path11;
var init_python_runtime = __esm({
  "packages/runtime/dist/python-runtime.js"() {
    "use strict";
    import_promises11 = require("node:fs/promises");
    import_node_path11 = __toESM(require("node:path"), 1);
  }
});

// packages/runtime/dist/python-pack-builder.js
async function writePythonPackManifest(packRoot, manifest) {
  const files = await (0, import_promises12.readdir)(packRoot, { recursive: true });
  const hash = (0, import_node_crypto10.createHash)("sha256");
  for (const file of files.sort()) {
    try {
      hash.update(await (0, import_promises12.readFile)(import_node_path12.default.join(packRoot, file)));
    } catch {
    }
  }
  const output = { ...manifest, sha256: hash.digest("hex") };
  const target = import_node_path12.default.join(packRoot, "manifest.json");
  await (0, import_promises12.writeFile)(target, JSON.stringify(output, null, 2), "utf8");
  return target;
}
var import_node_crypto10, import_promises12, import_node_path12;
var init_python_pack_builder = __esm({
  "packages/runtime/dist/python-pack-builder.js"() {
    "use strict";
    import_node_crypto10 = require("node:crypto");
    import_promises12 = require("node:fs/promises");
    import_node_path12 = __toESM(require("node:path"), 1);
  }
});

// packages/runtime/dist/sql-guard.js
var DANGEROUS_KEYWORDS, INJECTION_PATTERNS, SqlGuard;
var init_sql_guard = __esm({
  "packages/runtime/dist/sql-guard.js"() {
    "use strict";
    DANGEROUS_KEYWORDS = [
      "\\bDROP\\b",
      "\\bTRUNCATE\\b",
      "\\bDELETE\\b",
      "\\bALTER\\b",
      "\\bGRANT\\b",
      "\\bREVOKE\\b",
      "\\bINSERT\\b",
      "\\bUPDATE\\b",
      "\\bCALL\\b",
      "\\bCREATE\\b",
      "\\bRENAME\\b",
      "\\bREPLACE\\b",
      // REPLACE INTO
      "\\bLOAD\\s+DATA\\b",
      "\\bINTO\\s+OUTFILE\\b",
      "\\bINTO\\s+DUMPFILE\\b"
    ];
    INJECTION_PATTERNS = [
      ";\\s*\\w",
      // Multi-statement injection.
      // Standard SQL line comments (-- text) are valid and are not high-risk alone.
      "/\\*.*?\\*/",
      // Block comments can hide dangerous keywords.
      "\\bUNION\\s+(ALL\\s+)?SELECT\\b",
      "\\bEXEC\\b",
      "\\bXP_\\w+"
    ];
    SqlGuard = class {
      strict;
      dangerousPatterns;
      injectionPatterns;
      constructor(strict = true) {
        this.strict = strict;
        this.dangerousPatterns = DANGEROUS_KEYWORDS.map((p) => new RegExp(p, "i"));
        this.injectionPatterns = INJECTION_PATTERNS.map((p) => new RegExp(p, "is"));
      }
      check(sql) {
        if (!sql || !sql.trim())
          return { allowed: false, reason: "Empty query" };
        const sqlClean = sql.trim();
        for (const pattern of this.injectionPatterns) {
          if (pattern.test(sqlClean)) {
            return { allowed: false, reason: `SQL blocked: injection pattern detected [${pattern.source}]` };
          }
        }
        for (const pattern of this.dangerousPatterns) {
          if (pattern.test(sqlClean)) {
            return { allowed: false, reason: `SQL blocked: high-risk operation detected [${pattern.source}]` };
          }
        }
        return { allowed: true, reason: "" };
      }
    };
  }
});

// packages/runtime/dist/dashboard-migration.js
var dashboard_migration_exports = {};
__export(dashboard_migration_exports, {
  migrateDashboardFiles: () => migrateDashboardFiles,
  migrateV3SpecToV4: () => migrateV3SpecToV4
});
function queryFor(view) {
  const parts = [`dataset:${view.dataset ?? "__default__"}`, `type:${view.type}`];
  if (view.xField)
    parts.push(`x:${view.xField}`);
  if (view.yField)
    parts.push(`y:${view.yField}`);
  if (view.nameField)
    parts.push(`name:${view.nameField}`);
  if (view.valueField)
    parts.push(`value:${view.valueField}`);
  if (view.field)
    parts.push(`field:${view.field}`);
  if (view.aggregate)
    parts.push(`aggregate:${view.aggregate}`);
  return parts.join("|");
}
function fieldMappingFor(view) {
  const mapping = { dataset: view.dataset ?? "__default__" };
  if (view.xField)
    mapping.x = view.xField;
  if (view.yField)
    mapping.y = view.yField;
  if (view.nameField)
    mapping.name = view.nameField;
  if (view.valueField)
    mapping.value = view.valueField;
  if (view.field)
    mapping.field = view.field;
  if (view.aggregate)
    mapping.aggregate = view.aggregate;
  return mapping;
}
function migrateV3SpecToV4(spec) {
  if (spec.dashboardVersion === 4) {
    return { status: "unchanged", views: [], reasons: [] };
  }
  const datasetIds = new Set(spec.datasets.map((d) => d.id));
  const views = [];
  const viewResults = [];
  const parameters = {};
  for (const dataset of spec.datasets) {
    const filters = dataset.filters;
    for (const [name, value] of Object.entries(filters ?? {})) {
      parameters[name] = { type: typeof value === "number" ? "number" : typeof value === "boolean" ? "string" : "string", default: value };
    }
  }
  for (const [index, view] of spec.views.entries()) {
    const viewId = view.id ?? view.title ?? `${view.type}-${index}`;
    const reasons = [];
    if (!["line", "bar", "pie", "kpi", "table"].includes(view.type))
      reasons.push(`unsupported view type ${view.type}`);
    if (view.dataset && !datasetIds.has(view.dataset))
      reasons.push(`references unknown dataset ${view.dataset}`);
    if ((view.type === "line" || view.type === "bar") && (!view.xField || !view.yField))
      reasons.push("needs xField/yField");
    if (view.type === "pie" && (!view.nameField || !view.valueField))
      reasons.push("needs nameField/valueField");
    if (view.type === "kpi" && !view.field)
      reasons.push("needs field");
    if (reasons.length > 0) {
      viewResults.push({ viewId, status: "unsupported", reasons });
      continue;
    }
    views.push({ id: viewId, type: view.type, title: view.title, query: queryFor(view), fieldMapping: fieldMappingFor(view) });
    const viewFilters = view.filters;
    for (const [name, value] of Object.entries(viewFilters ?? {})) {
      parameters[name] = { type: typeof value === "number" ? "number" : "string", default: value };
      views[views.length - 1].fieldMapping[`filter:${name}`] = String(value);
    }
    viewResults.push({ viewId, status: "converted", reasons: [] });
  }
  const unsupportedViews = viewResults.filter((v) => v.status === "unsupported");
  if (spec.views.length === 0) {
    return { status: "unsupported", views: viewResults, reasons: ["spec has no views"] };
  }
  if (unsupportedViews.length > 0) {
    return {
      status: "unsupported",
      views: viewResults,
      reasons: unsupportedViews.flatMap((v) => v.reasons.map((r) => `${v.viewId}: ${r}`))
    };
  }
  const hasParameters = Object.keys(parameters).length > 0;
  return {
    status: "converted",
    views: viewResults,
    reasons: [],
    spec: {
      title: spec.title,
      ...hasParameters ? { parameters } : {},
      views
    }
  };
}
async function migrateDashboardFiles(paths, options) {
  const report = { migrationId: (0, import_node_crypto11.randomUUID)(), fromVersion: "v3", toVersion: "v4", converted: [], unchanged: [], unsupported: [] };
  for (const relativePath of paths) {
    const target = import_node_path13.default.resolve(options.root, relativePath);
    let raw;
    try {
      raw = await (0, import_promises13.readFile)(target, "utf8");
    } catch (error) {
      report.unsupported.push({ path: relativePath, reasons: [`unreadable: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      report.unsupported.push({ path: relativePath, reasons: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    if (parsed?.dashboardVersion === 4) {
      report.unchanged.push(relativePath);
      continue;
    }
    const result = migrateV3SpecToV4(parsed);
    if (result.status !== "converted" || !result.spec) {
      report.unsupported.push({ path: relativePath, reasons: result.reasons.length ? result.reasons : ["spec could not be converted"] });
      continue;
    }
    const backupPath = `${target}.v3.bak`;
    await (0, import_promises13.mkdir)(import_node_path13.default.dirname(backupPath), { recursive: true });
    await (0, import_promises13.copyFile)(target, backupPath).catch((error) => {
      if (error.code !== "EEXIST")
        throw error;
    });
    const converted = { dashboardVersion: 4, migratedFrom: "v3", migrationId: report.migrationId, ...result.spec };
    await (0, import_promises13.writeFile)(target, JSON.stringify(converted, null, 2), "utf8");
    report.converted.push(relativePath);
  }
  return report;
}
var import_node_crypto11, import_promises13, import_node_path13;
var init_dashboard_migration = __esm({
  "packages/runtime/dist/dashboard-migration.js"() {
    "use strict";
    import_node_crypto11 = require("node:crypto");
    import_promises13 = require("node:fs/promises");
    import_node_path13 = __toESM(require("node:path"), 1);
  }
});

// packages/runtime/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  ClarificationManager: () => ClarificationManager,
  DANGEROUS_KEYWORDS: () => DANGEROUS_KEYWORDS,
  DataAgentRuntime: () => DataAgentRuntime,
  DataAgentRuntimeError: () => DataAgentRuntimeError,
  ExportCapabilityError: () => ExportCapabilityError,
  INJECTION_PATTERNS: () => INJECTION_PATTERNS,
  InMemorySecretVault: () => InMemorySecretVault,
  KnowledgeIndex: () => KnowledgeIndex,
  KnowledgeWriteDeniedError: () => KnowledgeWriteDeniedError,
  KnowledgeWriter: () => KnowledgeWriter,
  LocalAuthService: () => LocalAuthService,
  MetadataStore: () => MetadataStore,
  PiJsonlSessionStore: () => PiJsonlSessionStore,
  ProcessSupervisor: () => ProcessSupervisor,
  ProviderRegistry: () => ProviderRegistry,
  SqlGuard: () => SqlGuard,
  WorkspaceStore: () => WorkspaceStore,
  assertNoLegacyTools: () => assertNoLegacyTools,
  canonicalLocalTools: () => canonicalLocalTools,
  createExportQueryAdapter: () => createExportQueryAdapter,
  effectiveTools: () => effectiveTools,
  loadRuntimeManifest: () => loadRuntimeManifest,
  loadSkillsFromDir: () => loadSkillsFromDir,
  migrateDashboardFiles: () => migrateDashboardFiles,
  migrateLegacyData: () => migrateLegacyData,
  migrateV3SpecToV4: () => migrateV3SpecToV4,
  moveSystemPrompt: () => moveSystemPrompt,
  probePython: () => probePython,
  readAuditLog: () => readAuditLog,
  resolvePythonRuntime: () => resolvePythonRuntime,
  runPythonJob: () => runPythonJob,
  semanticToolIdentity: () => semanticToolIdentity,
  writePythonPackManifest: () => writePythonPackManifest
});
var import_node_crypto12, DataAgentRuntimeError, DataAgentRuntime;
var init_dist4 = __esm({
  "packages/runtime/dist/index.js"() {
    "use strict";
    init_dist();
    init_value2();
    init_metadata();
    import_node_crypto12 = require("node:crypto");
    init_session_store();
    init_workspace();
    init_python_job();
    init_knowledge();
    init_clarification();
    init_dashboard_v3();
    init_dashboard_v4();
    init_auth();
    init_legacy_migration();
    init_python_job();
    init_skills2();
    init_knowledge();
    init_knowledge_write();
    init_export_adapter();
    init_process_supervisor();
    init_clarification();
    init_providers();
    init_tools_catalog();
    init_workspace();
    init_python_runtime();
    init_python_pack_builder();
    init_metadata();
    init_sql_guard();
    init_dashboard_migration();
    init_session_store();
    DataAgentRuntimeError = class extends Error {
      code;
      details;
      constructor(code, message, details) {
        super(message);
        this.name = "DataAgentRuntimeError";
        this.code = code;
        this.details = details;
      }
    };
    DataAgentRuntime = class {
      listeners = /* @__PURE__ */ new Set();
      eventBuffer = [];
      metadata;
      /** Exposed for host-level services (e.g. persistent auth). */
      get metadataStore() {
        return this.metadata;
      }
      sessions;
      workspace;
      pythonExecutable;
      knowledge;
      knowledgeRoot;
      semanticProjectDir;
      queryExecutor;
      dbTester;
      llmTester;
      providerRegistry;
      mcpSupervisor;
      ingestJob;
      clarifications;
      activeRun;
      agent;
      constructor(options = {}) {
        this.metadata = options.metadata;
        this.sessions = options.sessions;
        this.workspace = options.workspace;
        this.pythonExecutable = options.pythonExecutable;
        this.knowledge = options.knowledge;
        this.knowledgeRoot = options.knowledgeRoot;
        this.semanticProjectDir = options.semanticProjectDir;
        this.clarifications = options.clarifications ?? new ClarificationManager();
        this.clarifications.onAsked = (request) => {
          this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: "clarification", timestamp: Date.now(), sessionId: request.sessionId, event: { type: "clarification.request", clarificationId: request.clarificationId, question: request.question, options: request.options } });
        };
        this.clarifications.onSettled = (clarificationId, outcome) => {
          this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: "clarification", timestamp: Date.now(), event: { type: "clarification.settled", clarificationId, outcome } });
        };
        this.agent = options.agent;
        this.agent?.subscribe?.((event) => this.mapPiEvent(event));
      }
      nextSequence = 1;
      eventsAfter(sequence2) {
        return this.eventBuffer.filter((event) => event.sequence > sequence2);
      }
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      async dispatch(command, context) {
        this.assertContext(context);
        if (command.protocolVersion !== ProtocolVersion) {
          throw new DataAgentRuntimeError("UNSUPPORTED_PROTOCOL_VERSION", `Unsupported protocol version: ${command.protocolVersion}`, { supported: ProtocolVersion });
        }
        if (command.command.type === "workspace.list" || command.command.type === "workspace.read" || command.command.type === "workspace.write" || command.command.type === "workspace.delete") {
          if (!this.workspace)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Workspace is not configured");
          this.workspace.assertAccess(context);
          if (command.command.type === "workspace.list")
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "list", files: await this.workspace.list() } };
          if (command.command.type === "workspace.read")
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "read", path: command.command.path, content: await this.workspace.read(command.command.path) } };
          if (command.command.type === "workspace.delete") {
            await this.workspace.delete(command.command.path);
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "write", path: command.command.path } };
          }
          await this.workspace.write(command.command.path, command.command.content);
          this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: command.command.path, kind: "file" } });
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "write", path: command.command.path } };
        }
        if (command.command.type === "dashboard.generate") {
          if (!this.workspace)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Workspace is not configured");
          this.workspace.assertAccess(context);
          const c = command.command;
          if (c.version === "v3" && c.mode === "static") {
            const validated = validateDashboardV3Spec(c.spec);
            if (!validated.ok || c.operation === "validate") {
              return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: validated.ok, errors: validated.ok ? [] : validated.errors } };
            }
            const target = c.editPath ?? `dashboards/${Date.now()}.html`;
            const html = await renderStandaloneDashboardHtml(validated.spec);
            await this.workspace.write(target, html);
            this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: target, kind: "file" } });
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: true, errors: [], path: target, bytes: html.length } };
          }
          if (c.version === "v4" && c.mode === "semantic") {
            const validated = validateDashboardV4Spec(c.spec);
            if (!validated.ok || c.operation === "validate") {
              return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: validated.ok, errors: validated.ok ? [] : validated.errors } };
            }
            const target = c.editPath ?? `dashboards/${Date.now()}-semantic.html`;
            const nonce = (0, import_node_crypto12.randomUUID)();
            const html = renderSemanticDashboardHtml(validated.spec, { nonce, expectedOrigin: "https://data-agent.local" });
            await this.workspace.write(target, html);
            this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: target, kind: "file" } });
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: true, errors: [], path: target, bytes: html.length } };
          }
          throw new DataAgentRuntimeError("INVALID_COMMAND", "Unsupported dashboard mode/version combination");
        }
        if (command.command.type === "clarification.answer") {
          const answered = this.clarifications.answer(command.command.clarificationId, command.command.answer);
          if (!answered)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Unknown or already settled clarification");
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "runtime.probe.result", service: "data-agent-runtime", runtimeVersion: "0.1.0" } };
        }
        if (command.command.type === "semantic.sources.list" && this.semanticProjectDir) {
          const { resolve: resolvePath2 } = await import("node:path");
          const fs = await import("node:fs/promises");
          const base = resolvePath2(this.semanticProjectDir);
          const sources = [];
          const seen = /* @__PURE__ */ new Set();
          for (const segment of ["business-semantic", "semantic-layer"]) {
            let connections = [];
            try {
              connections = await fs.readdir(resolvePath2(base, segment));
            } catch {
              connections = [];
            }
            for (const connectionId of connections) {
              const connDir = resolvePath2(base, segment, connectionId);
              let entries = [];
              try {
                entries = await fs.readdir(connDir, { withFileTypes: true });
              } catch {
                continue;
              }
              for (const entry of entries) {
                if (!entry.isFile() || !(entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")))
                  continue;
                const sourceName = entry.name.replace(/\.ya?ml$/i, "");
                const key = `${connectionId}/${sourceName}`;
                if (seen.has(key))
                  continue;
                seen.add(key);
                const full = resolvePath2(connDir, entry.name);
                const info = await fs.stat(full);
                sources.push({ connectionId, sourceName, definition: {}, updatedAt: info.mtimeMs });
              }
            }
          }
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.sources.result", sources } };
        }
        if (command.command.type === "semantic.sources.get" && this.semanticProjectDir) {
          const { resolve: resolvePath2 } = await import("node:path");
          const fs = await import("node:fs/promises");
          const getCmd = command.command;
          const segments = ["business-semantic", "semantic-layer"];
          const candidates = segments.flatMap((segment) => [".yaml", ".yml"].map((ext) => resolvePath2(this.semanticProjectDir, segment, getCmd.connectionId, getCmd.sourceName + ext)));
          let rawYaml = null;
          for (const candidate of candidates) {
            try {
              rawYaml = await fs.readFile(candidate, "utf8");
              break;
            } catch {
            }
          }
          if (rawYaml === null)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "SEMANTIC_SOURCE_NOT_FOUND");
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.source.result", source: { connectionId: getCmd.connectionId, sourceName: getCmd.sourceName, definition: { rawYaml }, updatedAt: Date.now() } } };
        }
        if (command.command.type === "semantic.sources.list") {
          const rows = await this.metadata.listSemanticSources() ?? [];
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.sources.result", sources: rows.map((r) => ({ connectionId: String(r.connectionId), sourceName: String(r.sourceName), definition: JSON.parse(String(r.definitionJson)), updatedAt: r.updatedAt })) } };
        }
        if (command.command.type === "semantic.sources.get") {
          const row = await this.metadata.getSemanticSource(command.command.connectionId, command.command.sourceName);
          if (!row)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "SEMANTIC_SOURCE_NOT_FOUND");
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.source.result", source: { connectionId: String(row.connectionId), sourceName: String(row.sourceName), definition: JSON.parse(String(row.definitionJson)), updatedAt: row.updatedAt } } };
        }
        if (command.command.type === "mcp.config.get" || command.command.type === "mcp.config.save") {
          if (command.command.type === "mcp.config.save")
            await this.metadata.setConfig("mcp.config", command.command.config);
          const config = await this.metadata.getConfig("mcp.config") ?? null;
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.config.result", config } };
        }
        if (command.command.type === "skills.list") {
          const { resolve: resolvePath2 } = await import("node:path");
          const { loadSkillsFromDir: loadSkillsFromDir2 } = await Promise.resolve().then(() => (init_skills2(), skills_exports));
          const skillsRoot = resolvePath2(this.knowledgeRoot, "..", "skills");
          const { skills: loaded } = await loadSkillsFromDir2(skillsRoot);
          const skills = [];
          for (const sk of loaded)
            skills.push({ name: String(sk.name ?? ""), description: String(sk.description ?? ""), tools: Array.isArray(sk.tools) ? sk.tools.map(String) : [] });
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "skills.list.result", skills } };
        }
        if (command.command.type === "dashboard.migrate") {
          if (!this.workspace)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Workspace is not configured");
          this.workspace.assertAccess(context);
          const root = this.workspace.root;
          const { migrateDashboardFiles: migrateDashboardFiles2 } = await Promise.resolve().then(() => (init_dashboard_migration(), dashboard_migration_exports));
          const report = await migrateDashboardFiles2(command.command.paths, { root });
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.migrate.result", ...report } };
        }
        if (command.command.type === "dashboard.evaluate") {
          if (!this.queryExecutor)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "QUERY_EXECUTOR_NOT_CONFIGURED");
          const limit = Math.min(command.command.rowLimit ?? 1e3, 1e4);
          const guarded = /\b(drop|delete|insert|update|alter|create|truncate)\b/i.test(command.command.sql);
          if (guarded)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "FORBIDDEN_SQL_IN_EVALUATE");
          const result = await this.queryExecutor.run(command.command.sql, limit);
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.evaluate.result", columns: result.columns, rows: result.rows, rowCount: result.rows.length, truncated: result.truncated } };
        }
        if (command.command.type === "semantic.ingest.status") {
          if (!this.ingestJob)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "INGEST_JOB_NOT_CONFIGURED");
          const status = await this.ingestJob.getStatus();
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.ingest.status.result", ...status } };
        }
        if (command.command.type === "semantic.ingest.retry") {
          if (!this.ingestJob)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "INGEST_JOB_NOT_CONFIGURED");
          const result = await this.ingestJob.retry();
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.ingest.retry.result", accepted: result.accepted } };
        }
        if (command.command.type === "dashboard.v3.data") {
          if (!this.workspace)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "WORKSPACE_NOT_CONFIGURED");
          const html = await this.workspace.read(command.command.path);
          const match = /window\.__DASHBOARD__=(\{[\s\S]*?\});<\/script>/.exec(html);
          if (!match)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "LEGACY_DASHBOARD_REQUIRES_REGENERATION");
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.v3.data.result", payload: JSON.parse(match[1]) } };
        }
        if (command.command.type === "config.get" || command.command.type === "config.save") {
          if (command.command.type === "config.save") {
            const current = await this.metadata.getConfig("ui.settings") ?? {};
            await this.metadata.setConfig("ui.settings", { ...current, ...command.command.patch });
          }
          const config = await this.metadata.getConfig("ui.settings") ?? {};
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "config.get.result", config } };
        }
        if (command.command.type === "python.runtime.test") {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);
          const executable = command.command.executable || this.pythonExecutable || "python";
          try {
            const { stdout } = await execFileAsync(executable, ["--version"], { timeout: 15e3 });
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: true, message: stdout.trim() } };
          } catch (error) {
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: false, message: error instanceof Error ? error.message : String(error) } };
          }
        }
        if (command.command.type === "db.test") {
          if (!this.dbTester)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "DB_TESTER_NOT_CONFIGURED");
          const result = await this.dbTester.test(command.command.connection);
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: result.success, message: result.message } };
        }
        if (command.command.type === "llm.test") {
          if (!this.llmTester)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "LLM_TESTER_NOT_CONFIGURED");
          const result = await this.llmTester.test(command.command.profile);
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: result.success, message: result.message, details: result.details } };
        }
        if (command.command.type === "config.llm.list") {
          const profiles = this.providerRegistry ? this.providerRegistry.list() : [];
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "config.llm.list.result", profiles } };
        }
        if (command.command.type === "config.llm.save") {
          if (!this.providerRegistry)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "PROVIDER_REGISTRY_NOT_CONFIGURED");
          const saved = await this.providerRegistry.save(command.command.profile);
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "config.llm.save.result", profile: saved } };
        }
        if (command.command.type === "mcp.servers.status") {
          if (!this.mcpSupervisor)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "MCP_SUPERVISOR_NOT_CONFIGURED");
          const servers = await this.mcpSupervisor.status();
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.servers.status.result", servers } };
        }
        if (command.command.type === "mcp.server.test" || command.command.type === "mcp.server.restart") {
          if (!this.mcpSupervisor)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "MCP_SUPERVISOR_NOT_CONFIGURED");
          if (command.command.type === "mcp.server.test") {
            const result2 = await this.mcpSupervisor.test(command.command.name);
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.server.test.result", ok: result2.ok, message: result2.message } };
          }
          const result = await this.mcpSupervisor.restart(command.command.name);
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.server.restart.result", ok: result.ok } };
        }
        if (command.command.type === "session.transcript") {
          if (!this.sessions)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "SESSION_STORE_NOT_CONFIGURED");
          const listed = await this.sessions.list();
          const transcriptCmd = command.command;
          const match = listed.find((meta) => (meta.metadata ?? {}).sessionId === transcriptCmd.sessionId || String(meta.id ?? "") === transcriptCmd.sessionId);
          const messages = [];
          if (match) {
            const session = await this.sessions.open(match);
            const entries = await session.getEntries();
            for (const entry of entries) {
              if (entry.type !== "message")
                continue;
              const message = entry.message;
              const role = message.role === "assistant" ? "agent" : String(message.role ?? "user");
              let text = "";
              for (const part of Array.isArray(message.content) ? message.content : []) {
                if (part.type === "text" && typeof part.text === "string")
                  text += part.text;
              }
              if (!text)
                continue;
              messages.push({ id: entry.id, role, content: text, timestamp: Date.parse(entry.timestamp) || 0 });
            }
          }
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "session.transcript.result", messages } };
        }
        if (command.command.type === "session.prepare") {
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "runtime.probe.result", service: "data-agent-runtime", runtimeVersion: "0.1.0" } };
        }
        if (command.command.type === "python.run") {
          if (!this.pythonExecutable)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Python runtime is not configured");
          if (!context.sessionId)
            throw new DataAgentRuntimeError("INVALID_CONTEXT", "Python jobs require a session workspace");
          const result = await runPythonJob(command.command.code, { workspace: context.sessionId, executable: this.pythonExecutable });
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "python.result", jobId: result.jobId, status: result.status, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, scriptPath: result.scriptPath, durationMs: result.durationMs } };
        }
        if (command.command.type === "knowledge.search" || command.command.type === "knowledge.read" || command.command.type === "knowledge.list" || command.command.type === "knowledge.save") {
          if (command.command.type === "knowledge.save" && !this.knowledgeRoot)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge root is not configured");
          if (!this.knowledgeRoot && command.command.type !== "knowledge.save")
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge index is not configured");
          const { resolve: resolvePath2, join: joinPath } = await import("node:path");
          if (this.knowledge)
            await this.knowledge.loadDirectory(this.knowledgeRoot);
          if (command.command.type === "knowledge.search")
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.search.result", hits: this.knowledge.search(command.command.query) } };
          if (command.command.type === "knowledge.list") {
            const { readdir: readdir8, stat: stat4 } = await import("node:fs/promises");
            const files = [];
            const walk = async (dir) => {
              for (const entry of await readdir8(dir, { withFileTypes: true })) {
                const full = dir + "/" + entry.name;
                if (entry.isDirectory())
                  await walk(full);
                else if (entry.name.endsWith(".md")) {
                  const info = await stat4(full);
                  files.push({ path: full.slice(this.knowledgeRoot.length + 1), size: info.size, modifiedAt: info.mtimeMs });
                }
              }
            };
            await walk(this.knowledgeRoot);
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.list.result", files } };
          }
          if (command.command.type === "knowledge.save") {
            if (command.command.path.startsWith(".pi/"))
              throw new DataAgentRuntimeError("INVALID_COMMAND", "SYSTEM_PROMPT_IMMUTABLE");
            const { writeFile: writeFile9, mkdir: mkdir9 } = await import("node:fs/promises");
            const target2 = resolvePath2(joinPath(this.knowledgeRoot, command.command.path));
            if (!target2.startsWith(resolvePath2(this.knowledgeRoot)))
              throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge path escapes root");
            await mkdir9(joinPath(target2, ".."), { recursive: true });
            await writeFile9(target2, command.command.content, "utf8");
            return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.save.result", path: command.command.path } };
          }
          const { readFile: readFile11 } = await import("node:fs/promises");
          const target = resolvePath2(joinPath(this.knowledgeRoot, command.command.path));
          if (!target.startsWith(resolvePath2(this.knowledgeRoot)))
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge path escapes root");
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.read.result", path: command.command.path, content: await readFile11(target, "utf8") } };
        }
        if (command.command.type === "agent.steer" || command.command.type === "agent.follow_up") {
          if (!this.agent)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
          const method = command.command.type === "agent.steer" ? this.agent.steer : this.agent.followUp;
          if (!method)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Agent queue operation is not configured");
          method.call(this.agent, command.command.prompt);
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId: "queued" } };
        }
        if (command.command.type === "agent.stop") {
          if (!this.agent)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
          this.agent.abort();
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId: "stopped" } };
        }
        if (command.command.type === "agent.prompt") {
          if (!this.agent)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
          const runId = (0, import_node_crypto12.randomUUID)();
          this.activeRun = { requestId: command.requestId, runId, sessionId: context.sessionId };
          void this.agent.prompt(command.command.prompt).then(() => {
            this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, runId, timestamp: Date.now(), event: { type: "agent.completed" } });
            this.activeRun = void 0;
          });
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId } };
        }
        if (command.command.type !== "runtime.probe") {
          if (!this.metadata)
            throw new DataAgentRuntimeError("INVALID_COMMAND", "Metadata store is not configured");
          const c = command.command;
          const userId = context.userId;
          if (c.type === "task.create")
            return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, { idValue: MetadataStore.createId(), name: c.name }));
          if (c.type === "task.list")
            return this.list(command.requestId, "task", await this.metadata.call(c.type, userId));
          if (c.type === "task.rename" || c.type === "task.delete")
            return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, c));
          if (c.type === "session.create") {
            const item = await this.metadata.call(c.type, userId, { ...c, idValue: MetadataStore.createId() });
            if (this.sessions)
              await this.sessions.create({ userId, taskId: c.taskId, sessionId: item.id });
            await this.metadata.call("outbox.enqueue", userId, { sessionId: item.id, sequence: 0 });
            return this.mutation(command.requestId, "session", item);
          }
          if (c.type === "session.list")
            return this.list(command.requestId, "session", await this.metadata.call(c.type, userId, c));
          if (c.type === "session.rename" || c.type === "session.delete")
            return this.mutation(command.requestId, "session", await this.metadata.call(c.type, userId, c));
          throw new DataAgentRuntimeError("INVALID_COMMAND", "Unsupported DataAgent command");
        }
        const response = {
          protocolVersion: ProtocolVersion,
          requestId: command.requestId,
          response: {
            type: "runtime.probe.result",
            service: "data-agent-runtime",
            runtimeVersion: "0.1.0"
          }
        };
        if (!value_exports.Check(DataAgentResponseEnvelopeSchema, response)) {
          throw new DataAgentRuntimeError("INVALID_COMMAND", "Runtime produced an invalid response");
        }
        this.emit({
          protocolVersion: ProtocolVersion,
          sequence: this.nextSequence++,
          requestId: command.requestId,
          timestamp: Date.now(),
          event: {
            type: "runtime.probe.completed",
            service: "data-agent-runtime"
          }
        });
        return response;
      }
      /** Tools call this to suspend the run until the user answers or timeout hits. */
      askClarification(sessionId, question, options, timeoutMs) {
        const asked = this.clarifications.ask(sessionId, question, options, timeoutMs);
        this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: "clarification", sessionId, timestamp: Date.now(), event: { type: "clarification.request", clarificationId: asked.clarificationId, question, options } });
        return asked;
      }
      cancelSessionClarifications(sessionId) {
        this.clarifications.cancel(sessionId, "cancelled");
      }
      mapPiEvent(event) {
        const run = this.activeRun;
        if (!run || !event?.type)
          return;
        const base = () => ({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: run.requestId, runId: run.runId, sessionId: run.sessionId, timestamp: Date.now() });
        if (event.type === "message_start") {
          this.emit({ ...base(), event: { type: "agent.message_started", messageId: String(event.message?.id ?? "") } });
          return;
        }
        if (event.type === "message_update") {
          const update = event.assistantMessageEvent;
          if (update?.type !== "text_delta" && update?.type !== "thinking_delta")
            return;
          this.emit({ ...base(), event: { type: update.type === "text_delta" ? "agent.text_delta" : "agent.thinking_delta", delta: update.delta } });
          return;
        }
        if (event.type === "tool_execution_start") {
          this.emit({ ...base(), event: { type: "agent.tool_started", toolCallId: String(event.toolCallId), toolName: String(event.toolName), args: event.args ?? null } });
          return;
        }
        if (event.type === "tool_execution_end") {
          this.emit({ ...base(), event: { type: "agent.tool_finished", toolCallId: String(event.toolCallId), toolName: String(event.toolName), result: event.result ?? null, isError: Boolean(event.isError) } });
          return;
        }
      }
      mutation(requestId, entity, item) {
        return { protocolVersion: ProtocolVersion, requestId, response: { type: "mutation.result", entity, item } };
      }
      list(requestId, entity, items) {
        return { protocolVersion: ProtocolVersion, requestId, response: { type: "list.result", entity, items } };
      }
      assertContext(context) {
        if (!value_exports.Check(RequestContextSchema, context)) {
          throw new DataAgentRuntimeError("INVALID_CONTEXT", "Invalid request context");
        }
      }
      emit(event) {
        if (!value_exports.Check(DataAgentEventEnvelopeSchema, event)) {
          throw new DataAgentRuntimeError("INVALID_COMMAND", "Runtime produced an invalid event");
        }
        this.eventBuffer.push(event);
        if (this.eventBuffer.length > 256)
          this.eventBuffer.shift();
        for (const listener of this.listeners)
          listener(event);
      }
    };
  }
});

// packages/electron-host/dist/index.js
var index_exports = {};
__export(index_exports, {
  registerElectronRuntimeIpc: () => registerElectronRuntimeIpc
});
function registerElectronRuntimeIpc(ipcMain, runtime, options = {}) {
  const contextFactory = options.contextFactory ?? (() => ({ userId: "local", host: "electron" }));
  ipcMain.handle("data-agent:command", async (event, payload) => {
    try {
      const command = parseDataAgentCommandEnvelope(payload);
      return await runtime.dispatch(command, contextFactory(event));
    } catch (error) {
      throw toIpcError(error);
    }
  });
  return () => ipcMain.removeHandler("data-agent:command");
}
function toIpcError(error) {
  if (error instanceof DataAgentRuntimeError)
    return error;
  if (error instanceof TypeError) {
    return new DataAgentRuntimeError("INVALID_COMMAND", error.message);
  }
  return new DataAgentRuntimeError("INVALID_COMMAND", "DataAgent command failed", {
    cause: error instanceof Error ? error.message : String(error)
  });
}
var init_index = __esm({
  "packages/electron-host/dist/index.js"() {
    "use strict";
    init_dist();
    init_dist4();
  }
});

// packages/electron-host/dist/main.js
var main_exports = {};
__export(main_exports, {
  resolveRuntimePaths: () => resolveRuntimePaths,
  startElectronHost: () => startElectronHost
});
module.exports = __toCommonJS(main_exports);
var import_node_fs4 = require("node:fs");
var import_node_path14 = __toESM(require("node:path"), 1);
function resolveRuntimePaths(options) {
  let appDir = options.appDir;
  if (!appDir && typeof __dirname !== "undefined") {
    const insideAsar = __dirname.includes(`${import_node_path14.default.sep}app.asar`);
    appDir = insideAsar ? import_node_path14.default.resolve(__dirname, "..") : import_node_path14.default.resolve(__dirname, "..", "..");
  }
  return {
    userDataDir: options.userDataDir,
    // Renderer output lives in <app>/dist when packaged via electron-builder files config
    rendererDist: import_node_path14.default.join(appDir ?? process.cwd(), "dist")
  };
}
async function startElectronHost(deps, overrides = {}) {
  const { DataAgentRuntime: DataAgentRuntime2, MetadataStore: MetadataStore2, PiJsonlSessionStore: PiJsonlSessionStore2 } = await Promise.resolve().then(() => (init_dist4(), dist_exports));
  const { KnowledgeIndex: KnowledgeIndex2 } = await Promise.resolve().then(() => (init_dist4(), dist_exports));
  const { registerElectronRuntimeIpc: registerElectronRuntimeIpc2 } = await Promise.resolve().then(() => (init_index(), index_exports));
  const paths = resolveRuntimePaths({ userDataDir: deps.app.getPath("userData") });
  if (overrides.userDataDir)
    paths.userDataDir = overrides.userDataDir;
  if (overrides.rendererDist)
    paths.rendererDist = overrides.rendererDist;
  const effectiveResources = overrides.resourcesPath ?? deps.resourcesPath;
  let pythonExecutable;
  const bundledPython = import_node_path14.default.join(effectiveResources ?? "", "python-runtime", "Scripts", "python.exe");
  if (effectiveResources && (0, import_node_fs4.existsSync)(bundledPython))
    pythonExecutable = bundledPython;
  for (const dir of ["metadata", "sessions", "workspace", "knowledge"]) {
    (0, import_node_fs4.mkdirSync)(import_node_path14.default.join(paths.userDataDir, dir), { recursive: true });
  }
  const metadata = new MetadataStore2(import_node_path14.default.join(paths.userDataDir, "metadata", "app.db"));
  const sessions = new PiJsonlSessionStore2(import_node_path14.default.join(paths.userDataDir, "sessions"));
  const knowledgeRoot = import_node_path14.default.join(paths.userDataDir, "knowledge");
  let knowledge;
  try {
    knowledge = new KnowledgeIndex2(knowledgeRoot);
  } catch {
    knowledge = void 0;
  }
  const semanticProjectDir = process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR ? import_node_path14.default.resolve(process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR) : import_node_path14.default.join(paths.userDataDir, "semantic-context");
  const runtime = new DataAgentRuntime2({ metadata, sessions, knowledgeRoot, knowledge, pythonExecutable, semanticProjectDir });
  registerElectronRuntimeIpc2(deps.ipcMain, runtime);
  await deps.app.whenReady();
  if (process.env.DATA_AGENT_SMOKE === "1") {
    const { writeFileSync } = await import("node:fs");
    try {
      writeFileSync(import_node_path14.default.join(paths.userDataDir, "smoke.ok"), "ok");
    } catch {
    }
    deps.app.quit();
    return;
  }
  const window = new deps.BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: import_node_path14.default.join(__dirname, "..", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await window.loadFile(import_node_path14.default.join(paths.rendererDist, "index.html"));
}
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test")
  void (async () => {
    try {
      const electronModule = "electron";
      const electron = await import(
        /* @vite-ignore */
        electronModule
      );
      await startElectronHost(electron, { resourcesPath: electron.resourcesPath });
    } catch (error) {
      try {
        const { appendFileSync } = await import("node:fs");
        appendFileSync(import_node_path14.default.join(process.env.TEMP ?? process.cwd(), "data-agent-main-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] electron host failed to start:
${error instanceof Error ? error.stack : String(error)}
`);
      } catch {
      }
      console.error("electron host failed to start:", error);
      const electronModule2 = "electron";
      try {
        const { app: crashedApp } = await import(
          /* @vite-ignore */
          electronModule2
        );
        crashedApp.exit?.(1);
      } catch {
      }
      process.exitCode = 1;
    }
  })();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  resolveRuntimePaths,
  startElectronHost
});
