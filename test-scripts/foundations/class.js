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

var Class = exports.Class =
    {
        create: function(superclass, methods)
        {
            if (!methods)
            {
                // If we're the bottom to the chain, we use our own set of base methods
                methods = superclass || {};
                methods.__proto__ = this._base;
            }
            else
            {
                // Otherwise, we inherit methods from our superclass
                methods.__proto__ = superclass.prototype;
            }
            function clazz()
            {
                this.initialize.apply(this, arguments);
            }
            methods.constructor = clazz;

            if (typeof inBuiltinEnv !== 'undefined' && inBuiltinEnv) {
                setPrototype(clazz, methods);
            }
            else {
                clazz.prototype = methods;
            }
            return clazz;
        },

        _base:
        {
            initialize: function()
            {
            },

            /*
		 * Find the super method for the given method.  The argument method must have a name (e.g. function NAME() { ... }).
		 */
            $super: function(fn)
            {
                var s = this;
                if (fn._super)
                {
                    return function()
                    {
                        return fn._super.apply(s, arguments);
                    }
                }
                else
                {
                    var n = fn.name;
                    if (!n)
                    {
                        throw Err.create(-1, "No method name:" + fn);
                    }
                    for (var p = this.__proto__; p; p = p.__proto__)
                    {
                        if (p[n] === fn)
                        {
                            for (var p = p.__proto__; p; p = p.__proto__)
                            {
                                var f = p[n];
                                if (f)
                                {
                                    fn._super = f;
                                    return function()
                                    {
                                        return f.apply(s, arguments);
                                    }
                                }
                            }
                            break;
                        }
                    }
                    throw Err.create(-1, "Method not found: " + n);
                }
            }
        }
    };
