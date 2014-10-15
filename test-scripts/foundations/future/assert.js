// @@@LICENSE
//
//      Copyright (c) 2009-2012 Hewlett-Packard Development Company, L.P.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// LICENSE@@@

/** section: Foundations
* Assert
**/

/*jslint nomen: true, sloppy: true, white: true, vars: true, eqeq: true */

var Assert = {};
/** private
* Assert._templateReplace(msg, params) -> String
* - msg (String):  message to format
* - params (Object): parameters to fill in in msg template
* insert replacements in a template string
* returns string with replacements applied
**/
Assert._templateReplace = function _templateReplace(msg, params) {
    if (msg && typeof(msg.replace) === 'function') {
        var field;
        for (field in params) {
            if (params.hasOwnProperty(field)) {
                // Global replace without a regexp is non-standard...
                while (1) {
                    var value = params[field];
                    if (value === undefined) {
                        value = 'undefined';
                    } else if (value === null) {
                        value = 'null';
                    }
                    var key = "#{" + field + "}";
                    var oldMsg = msg;
                    msg = msg.replace(key, value.toString());
                    if (oldMsg === msg) {
                        break;
                    }
                }
            }
        }
    }
    return msg;
};

/** private
* Assert._throwMsg(template, defaultTemplate, params, defaultParams) -> undefined
* - template (String):  template
* - defaultTemplate (String):  template to use if no msg specified
* - params (Object): parameters for template replace
* - defaultParams (Object): parameters to use if none specified
* Creates and throws an Error, constructed by calling templateReplace with
* the provided template and arguments.
* There are two template arguments so each assert can provide their own default
* template and arguments, as well as passing along the user-specified one..
**/
Assert._throwMsg = function _throwMsg(msg, defaultMsg, params, defaultParams) {
    if (!msg) {
        msg = defaultMsg;
        params = defaultParams;
    }
    msg = Assert._templateReplace(msg, params);
    throw new Error(msg);
};
/** private
* Assert._squelchLogs
* provided to temporarily disable logging, so it doesn't interfere with
* test output, for example.
**/
Assert._squelchLogs = false;
/** private
* Assert._logMsg(template, defaultTemplate, params, DefaultParams) -> undefined
* - template (String):  template
* - defaultTemplate (String):  template to use if no msg specified
* - params (Object): parameters for template replace
* - defaultParams (Object): parameters to use if none specified
* Like _throwMsg, but simply logs the error, rather than throwing an exception
**/
Assert._logMsg = function _throwMsg(msg, defaultMsg, params, defaultParams) {
    if (!msg) {
        msg = defaultMsg;
        params = defaultParams;
    }
    msg = Assert._templateReplace(msg, params);
    Assert._lastLogMsg = msg;
    if (!Assert._squelchLogs) {
        if (typeof(Mojo) !== 'undefined') {
            Mojo.Log.error(msg);
        } else {
            console.error(msg);
        }
    }
};

/**
* Assert.require(exp[, msg][, params]) -> undefined
* -exp(Boolean): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the expression isn't true
**/
Assert.require = function require(exp, msg, params) {
    if (!exp) {
        Assert._throwMsg(msg, "Assert.require failed", params);
    }
};

/**
* Assert.requireFalse(exp[, msg][, params]) -> undefined
* -exp(Boolean): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the expression isn't false
**/
Assert.requireFalse = function requireFalse(exp, msg, params) {
    if (exp) {
        Assert._throwMsg(msg, "Assert.requireFalse failed", params);
    }
};

/**
* Assert.requireEqual(exp1, exp2[, msg][, params]) -> undefined
* -exp1(String): expression to test
* -exp2(String): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the expressions aren't equal (==)
**/
Assert.requireEqual = function requireEqual(exp1, exp2, msg, params) {
    if (exp1 != exp2) {
        Assert._throwMsg(msg, "Assert.requireEqual: #{a} != #{b}", params, {
            a: exp1,
            b: exp2
        });
    }
};

/**
* Assert.requireIdentical(exp1, exp2[, msg][, params]) -> undefined
* -exp1(String): expression to test
* -exp2(String): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the expressions aren't identical (===)
**/
Assert.requireIdentical = function requireIdentical(exp1, exp2, msg, params) {
    if (exp1 !== exp2) {
        Assert._throwMsg(msg, "Assert.requireIdentical: #{a} !== #{b}", params, {
            a: exp1,
            b: exp2
        });
    }
};

/**
* Assert.requireArray(obj[, msg][, params]) -> undefined
* -obj(Object): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't an array
**/
Assert.requireArray = function requireArray(obj, msg, params) {
    if (obj === undefined || Object.prototype.toString.apply(obj) !== '[object Array]') {
        Assert._throwMsg(msg, "Assert.requireArray: #{a} is not an Array", params, {
            a: obj
        });
    }
};

/**
* Assert.requireFunction(obj[, msg][, params]) -> undefined
* -obj(Object): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't a function
**/
Assert.requireFunction = function requireFunction(obj, msg, params) {
    if (typeof(obj) !== 'function') {
        Assert._throwMsg(msg, "Assert.requireFunction: #{a} is not a Function", params, {
            a: obj
        });
    }
};

/**
* Assert.requireString(obj[, msg][, params]) -> undefined
* -obj(Object): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't a string
**/
Assert.requireString = function requireString(obj, msg, params) {
    if (typeof(obj) !== 'string') {
        // catch strings created with new String() - this is ugly, but works in webkit and FF
        if (obj && (obj instanceof String || obj.constructor.name === 'String')) {
            return;
        }
        Assert._throwMsg(msg, "Assert.requireString: #{a} is not a String", params, {
            a: obj
        });
    }
};

/**
* Assert.requireNumber(obj[, msg][, params]) -> undefined
* -obj(Object): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't a number
**/
Assert.requireNumber = function requireNumber(obj, msg, params) {
    if (typeof(obj) !== 'number') {
        if (typeof(obj) === 'object' && (obj instanceof Number || obj.constructor.name === 'Number')) {
            return;
        }
        Assert._throwMsg(msg, "Assert.requireNumber: #{a} is not a Number", params, {
            a: obj
        });
    }
};

/**
* Assert.requireObject(obj[, msg][, params]) -> undefined
* -obj(Object): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
*  throw an error if the argument isn't an object
**/
Assert.requireObject = function requireObject(obj, msg, params) {
    if (typeof(obj) !== 'object' || obj===null) {
        Assert._throwMsg(msg, "Assert.requireObject: #{a} is not an Object", params, {
            a: obj
        });
    }
};

/**
* Assert.assertJSONObject(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to log
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't a valid JSON root object (an object of an array)
**/
Assert.requireJSONObject = function requireJSONObject(obj, msg, params) {
    var type = Object.prototype.toString.apply(obj);
    var test = type !== '[object Array]' && type != '[object Object]';
    if (test) {
        Assert._throwMsg(msg, "Assert.requireJSONObject: #{a} is not a valid JSON Object", params, {
            a: obj
        });
    }
    return ! test;
};

/**
* Assert.requireClass(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* -constructor(String): required constructor
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't a number
**/
Assert.requireClass = function requireClass(obj, constructor, msg, params) {
    var test = (obj !== undefined && obj.constructor === constructor);
    if (!test) {
        Assert._throwMsg(msg, 'Assert.requireClass: expected "#{a}", was "#{b}"', params, {
            a: constructor.name,
            b: obj.constructor.name
        });
    }
};

/**
* Assert.requireDefined(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't defined
**/
Assert.requireDefined = function requireDefined(obj, msg, params) {
    var test = (obj !== undefined);
    if (!test) {
        Assert._throwMsg(msg, "Assert.requireDefined: argument undefined", params);
    }
};

/**
* Assert.requireMatch(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* -pattern(String): pattern to match (regular expression)
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the pattern doesn't match
**/
Assert.requireMatch = function requireMatch(obj, pattern, msg, params) {
    var test = (obj.match(pattern));
    if (!test) {
        Assert._throwMsg(msg, "Assert.requireMatch: no match found", params);
    }
};

/**
* Assert.requireProperty(obj, props[, msg][, params]) -> undefined
* -obj(String): object to test
* -props(String): an object containing properties to validate: {property1:value1, property2:value2}
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the object doesn't have a particular property set as expected
**/
Assert.requireProperty = function requireProperty(obj, props, msg, params) {
    var p;
    for (p in props) {
        if (props.hasOwnProperty(p)) {
            var expected = props[p];
            var actual = obj[p];
            if (actual !== expected) {
                Assert._throwMsg(msg, "Assert.requireProperty: obj.#{a} != #{b}", params, {
                    a: p,
                    b: expected
                });
            }
        }
    }
};

/**
* Assert.requireError(context, func, args, error[, msg][, params]) -> undefined
* -context(String): "this" value for function call
* -func(String): function to run
* -args(String): array of arguments
* -error(String): expected error
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the function doesn't throw the expected error
**/
Assert.requireError = function requireError(context, func, args, error, msg, params) {
    try {
        func.apply(context, args);
    } catch(actual) {
        if (!error || actual == error) {
            return;
        }
        Assert._throwMsg(msg, "Assert.requireError: error thrown was '#{a}', instead of '#{e}'", params, {
            e: error,
            a: actual
        });
    }
    Assert._throwMsg(msg, "Assert.requireError: no error thrown", params);
};

/**
* Assert.assert(exp[, msg][, params]) ->undefined
* -exp(String): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the expression isn't true
**/
Assert.assert = function assert(exp, msg, params) {
    if (!exp) {
        Assert._logMsg(msg, "Assert.assert failed", params);
    }
    return exp;
};

/**
* Assert.assertFalse(exp[, msg][, params]) -> undefined
* -exp(String): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the expression isn't false
**/
Assert.assertFalse = function assertFalse(exp, msg, params) {
    if (exp) {
        Assert._logMsg(msg, "Assert.assertFalse failed", params);
    }
    return ! exp;
};

/**
* Assert.assertEqual(exp1, exp2[, msg][, params]) -> undefined
* -exp1(String): expression to test
* -exp2(String): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the expressions aren't equal (==)
**/
Assert.assertEqual = function assertEqual(exp1, exp2, msg, params) {
    var test = exp1 != exp2;
    if (test) {
        Assert._logMsg(msg, "Assert.assertEqual: #{a} != #{b}", params, {
            a: exp1,
            b: exp2
        });
    }
    return ! test;
};

/**
* Assert.assertIdentical(exp1, exp2[, msg][, params]) -> undefined
* -exp1(String): expression to test
* -exp2(String): expression to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the expressions aren't identical (===)
**/
Assert.assertIdentical = function assertIdentical(exp1, exp2, msg, params) {
    var test = exp1 !== exp2;
    if (test) {
        Assert._logMsg(msg, "Assert.assertEqual: #{a} !== #{b}", params, {
            a: exp1,
            b: exp2
        });
    }
    return ! test;
};

/**
* Assert.assertArray(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't an array
**/
Assert.assertArray = function assertArray(obj, msg, params) {
    var test = obj === undefined || Object.prototype.toString.apply(obj) !== '[object Array]';
    if (test) {
        Assert._logMsg(msg, "Assert.assertArray: #{a} is not an Array", params, {
            a: obj
        });
    }
    return ! test;
};

/**
* Assert.assertFunction(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't a function
**/
Assert.assertFunction = function assertFunction(obj, msg, params) {
    var test = typeof(obj) !== 'function';
    if (test) {
        Assert._logMsg(msg, "Assert.assertFunction: #{a} is not a Function", params, {
            a: obj
        });
    }
    return ! test;
};

/**
* Assert.assertString(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't a string
**/
Assert.assertString = function assertString(obj, msg, params) {
    var test = typeof(obj) !== 'string';
    if (test) {
        // catch strings created with new String() - this is ugly, but works in webkit and FF
        if (obj && (obj instanceof String || obj.constructor.name === 'String')) {
            return true;
        }
        Assert._logMsg(msg, "Assert.assertString: #{a} is not a String", params, {
            a: obj
        });
    }
    return ! test;
};

/**
* Assert.assertNumber(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't a number
**/
Assert.assertNumber = function assertNumber(obj, msg, params) {
    var test = typeof(obj) !== 'number';
    if (test) {
        if (typeof(obj) === 'object' && (obj instanceof Number || obj.constructor.name === 'Number')) {
            return true;
        }
        Assert._logMsg(msg, "Assert.assertNumber: #{a} is not a Number", params, {
            a: obj
        });
    }
    return ! test;
};

/**
* Assert.assertObject(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't an object
**/
Assert.assertObject = function assertObject(obj, msg, params) {
    var test = typeof(obj) !== 'object' || obj===null;
    if (test) {
        Assert._logMsg(msg, "Assert.assertObject: #{a} is not an Object", params, {
            a: obj
        });
    }
    return ! test;
};

/**
* Assert.assertClass(obj, constructor[, msg][, params]) -> undefined
* -obj(String): object to test
* -constructor(String): assertd constructor
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't a number
**/
Assert.assertClass = function assertClass(obj, constructor, msg, params) {
    var test = (obj !== undefined && obj.constructor === constructor);
    if (!test) {
        Assert._logMsg(msg, 'Assert.assertClass: expected "#{a}", was "#{b}"', params, {
            a: constructor.name,
            b: obj.constructor.name
        });
    }
    return test;
};

/**
* Assert.assertDefined(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the argument isn't defined
**/
Assert.assertDefined = function assertDefined(obj, msg, params) {
    var test = (obj !== undefined);
    if (!test) {
        Assert._logMsg(msg, "Assert.assertDefined: argument undefined", params);
    }
    return test;
};

/**
* Assert.assertMatch(obj, pattern[, msg][, params]) -> undefined
* -obj(String): object to test
* -pattern(String): pattern to match (regular expression)
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the pattern doesn't match
**/
Assert.assertMatch = function assertMatch(obj, pattern, msg, params) {
    var test = (obj.match(pattern));
    if (!test) {
        Assert._logMsg(msg, "Assert.assertMatch: no match found", params);
    }
    return test;
};

/**
* Assert.assertProperty(obj, props[, msg][, params]) -> undefined
* -obj(String): object to test
* -props(String): an object containing properties to validate: {property1:value1, property2:value2}
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the object doesn't have a particular property set as expected
**/
Assert.assertProperty = function assertProperty(obj, props, msg, params) {
    var p;
    for (p in props) {
        if (props.hasOwnProperty(p)) {
            var expected = props[p];
            var actual = obj[p];
            if (actual !== expected) {
                Assert._logMsg(msg, "Assert.assertProperty: obj.#{a} != #{b}", params, {
                    a: p,
                    b: expected
                });
                return false;
            }
        }
    }
    return true;
};

/**
* Assert.assertError(context, func, args, error[, msg][, params]) -> undefined
* -context(String): "this" value for function call
* -func(String): function to run
* -args(String): array of arguments
* -error(String): expected error
* - msg (String): message to throw
* - params (Object): parameters to fill in in msg template
* throw an error if the function doesn't throw the expected error
**/
Assert.assertError = function assertError(context, func, args, error, msg, params) {
    try {
        func.apply(context, args);
    } catch(actual) {
        if (!error || actual == error) {
            return true;
        }
        Assert._logMsg(msg, "Assert.assertError: error thrown was '#{a}', instead of '#{e}'", params, {
            e: error,
            a: actual
        });
        return false;
    }
    Assert._logMsg(msg, "Assert.assertError: no error thrown", params);
    return false;
};

/**
* Assert.assertJSONObject(obj[, msg][, params]) -> undefined
* -obj(String): object to test
* - msg (String): message to log
* - params (Object): parameters to fill in in msg template
* log an error if the argument isn't a valid JSON root object (an object of an array)
**/
Assert.assertJSONObject = function assertJSONObject(obj, msg, params) {
    var type = Object.prototype.toString.apply(obj);
    var test = type !== '[object Array]' && type != '[object Object]';
    if (test) {
        Assert._logMsg(msg, "Assert.assertJSONObject: #{a} is not a valid JSON Object", params, {
            a: obj
        });
    }
    return ! test;
};

module.exports = Assert;
