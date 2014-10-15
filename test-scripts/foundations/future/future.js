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

/*jslint indent: 4, node: true, nomen: true, sloppy: true, white: true */

var Assert = require("./assert"),
    Queue = require("./queue");

function Future(result)
{
    this._insidefuture = -1;
    this._then = [];
    this._result = { result: result, exception: undefined, isset: arguments.length > 0, wasread: false, cancelled: false };
}

Future.prototype.now = function now(scope, func, errorfunc)
{
    if (this._result.cancelled) {
        return this;
    } else {
        return this._docall(true, scope, func, errorfunc);
    }
};

Future.prototype.then = function then(scope, func, errorfunc)
{
    if (this._result.cancelled) {
        return this;
    } else {
        return this._docall(false, scope, func, errorfunc);
    }
};

Future.prototype.whilst = function whilst(scope, conditionfunc, func, errorfunc)
{
    if (typeof scope === "function")
    {
        errorfunc = func;
        func = conditionfunc;
        conditionfunc = scope;
        scope = null;
    } else {
        Assert.requireObject(scope, "Future.whilst(): scope must be an object, was #{type}",{type: typeof scope});
    }
    Assert.requireFunction(conditionfunc, "Future.whilst(): conditionfunc must be a function, was #{type}",{type: typeof conditionfunc});
    Assert.requireFunction(func, "Future.whilst(): func must be a function, was #{type}",{type: typeof func});
    if (errorfunc !== undefined) {
        Assert.requireFunction(errorfunc, "Future.whilst(): errorfunc must be a function, was #{type}",{type: typeof errorfunc});
    }
    return this.then(this, function checkAndRun()
                     {
        this.getResult();
        if (conditionfunc.call(scope, this))
        {
            if (scope !== null) {
                this.now(scope, func, errorfunc).then(this, checkAndRun);
            } else {
                this.now(func, errorfunc).then(this, checkAndRun);
            }
        }
        else
        {
            this.result = this.result;
        }
    });
};

Future.prototype.immediate = function immediate(val)
{
    // There can be no one to dispatch to since 'immediate' is only used to return a value immediately on
    // a future where no one will yet be waiting.
    this._result = { result: val, exception: undefined, isset: true, cancelled: false, wasread: false };
    return this;
};

Future.prototype.cancel = function cancel()
{
    this._result.isset = false;
    this._result.cancelled = true;
    this._then=[];
};

Future.prototype.status = function status()
{
    var r = this._result;
    if (r.isset)
    {
        if (r.exception)
        {
            return "exception";
        }
        else
        {
            return "result";
        }
    }
    else if (r.cancelled)
    {
        return "cancelled";
    }
    else
    {
        return "none";
    }
};

Future.prototype.onError = function onError(errorfunc)
{
    this._errorfunc = errorfunc;
};

Future.prototype._docall = function _docall(now, scope, func, errorfunc)
{
    var len, i;
    if (typeof scope === "function")
    {
        errorfunc = func;
        func = scope;
        scope = null;
    }
    /* TODO: figure out whether MapReduce can be changed such that we can make this check
    else {
        Assert.requireObject(scope, "Future.now() or Future.then(): scope should be an object, was #{type}",{type: typeof scope});
    }
    */
    // TODO: then() can take an Array instead of a function.
    //Assert.requireFunction(func, "Future.now() or Future.then(): func should be a function, was #{type}",{type: typeof func});
    // If no error function, use the future-wide error function
    if (!errorfunc)
    {
        errorfunc = this._errorfunc;
    }

    if (now)
    {
        this._insidefuture = 0;
        try
        {
            var v = func.call(scope, this);
            // Check type of returned value (if any)
            if (v !== undefined)
            {
                if (v && typeof v.then === "function") {
                    this.nest(v);
                } else {
                    this.setResult(v);
                }
            }
        }
        catch (e)
        {
            this._logexception(e);
            this._result = { result: undefined, exception: e, isset: false, cancelled: false, wasread: false };
            if (errorfunc)
            {
                try
                {
                    errorfunc.call(scope, this);
                }
                catch (e2)
                {
                    this._logexception(e2);
                }
            }
            else
            {
                this._result.isset = true;
            }
        }
        this._insidefuture = -1;
        if (this._then.length > 0)
        {
            this._maybeDispatch();
        }
    }
    else
    {
        // If we're not inside the future, push the 'then' on the end of the list
        //console.log(this._insidefuture, this._then.length);
        if (this._insidefuture === -1)
        {
            if (Object.prototype.toString.call(func) === "[object Array]")
            {
                len = func.length;
                for (i = 0; i < len; i++)
                {
                    this._then.push({ f: func[i], e: errorfunc, c: scope });
                }
            }
            else
            {
                this._then.push({ f: func, e: errorfunc, c: scope });
            }
            this._maybeDispatch();
        }
        // If we are inside the future, we insert the 'then' at the beginning of the list.
        // If we insert multiple 'then' clauses inside the future, we make sure the occur in the order
        // we inserted them in
        else
        {
            if (Object.prototype.toString.call(func) === "[object Array]")
            {
                len = func.length;
                for (i = 0; i < len; i++)
                {
                    this._then.splice(this._insidefuture++, 0, { f: func[i], e: errorfunc, c: scope });
                }
            }
            else
            {
                this._then.splice(this._insidefuture++, 0, { f: func, e: errorfunc, c: scope });
            }
        }
    }
    return this;
};

Future.prototype.callback = function callback(scope, func)
{
    if (typeof scope === "function")
    {
        func = scope;
        scope = undefined;
    }
    else if (!func)
    {
        throw new Error("Must define function");
    }
    return Queue.current.wrap(this, function()
                              {
        // We consider callbacks to be called inside the Future
        this._insidefuture = 0;
        try
        {
            var v = func.apply(scope, arguments);
            if (v !== undefined)
            {
                if (v && typeof v.then === "function") {
                    this.nest(v);
                } else {
                    this.setResult(v);
                }
            }
        }
        catch (e)
        {
            this._logexception(e);
            this._result = { result: undefined, exception: e, isset: true, cancelled: false, wasread: false };
        }
        this._insidefuture = -1;
        if (this._then.length > 0)
        {
            this._maybeDispatch();
        }
    });
};

Future.prototype.nest = function nest(innerfuture)
{
    Assert.requireObject(innerfuture, "Future.nest() expects to be passed a Future, was of type #{type}",{type: typeof innerfuture});
    Assert.requireObject(innerfuture._result, "Future.nest() expects to be passed a Future");
    if (innerfuture._result.isset)
    {
        // If innerfuture is already complete, we just copy the result over immediately and dispatch
        // only if there's someone waiting
        this._result = innerfuture._result;
        if (this._then.length > 0)
        {
            this._maybeDispatch();
        }
    }
    else
    {
        innerfuture.then(this, function()
                         {
            try
            {
                this.result = innerfuture.result;
            }
            catch (e)
            {
                this.exception = e;
            }
        });
    }
    return this;
};

Future.prototype._maybeDispatch = function _maybeDispatch()
{
    if (this._insidefuture === -1)
    {
        while (this._then.length > 0 && this._result.isset)
        {
            this._insidefuture = 0;
            var args = this._then.shift();
            try
            {
                this._result.isset = false;
                var v;
                if (args.e && this._result.exception)
                {
                    v = args.e.call(args.c, this);
                }
                else
                {
                    v = args.f.call(args.c, this);
                }
                // Check type of returned value (if any)
                if (v !== undefined)
                {
                    if (v && typeof v.then === "function") {
                        this.nest(v);
                    } else {
                        this.setResult(v);
                    }
                }
                // If the exception wasn't handled, we throw it into the next 'then' - we really dont want them to be lost
                if (!this._result.wasread && this._result.exception)
                {
                    this._result.isset = true;
                }
            }
            catch (e)
            {
                this._logexception(e);
                this._result = { result: undefined, exception: e, isset: false, cancelled: false, wasread: false };
                if (args.e)
                {
                    try
                    {
                        args.e.call(args.c, this);
                    }
                    catch (e2)
                    {
                        this._logexception(e2);
                    }
                }
                else
                {
                    this._result.isset = true;
                }
            }
        }
        this._insidefuture = -1;
    }
};

Future.prototype._logexception = function _logexception(e)
{
    console.error(e.stack || e);
};

Future.prototype.getResult = function getResult() {
    return this.result;
};

Future.prototype.setResult = function setResult(value) {
    this.result = value;
};

Future.prototype.getException = function getException() {
    return this.exception;
};

Future.prototype.setException = function setException(value) {
    this.exception = value;
};

Future.prototype.__defineGetter__("result", function getResult() {
    this._result.wasread = true;
    if (this._result.exception)
    {
        throw this._result.exception;
    }
    else
    {
        return this._result.result;
    }
});

Future.prototype.__defineSetter__("result", function setResult(val) {
    if (this._result.cancelled) {
        // don't do anything on a cancelled future
        return;
    }
    if (this._result.exception && !this._result.wasread)
    {
        this._result.wasread = true;
        throw this._result.exception;
    }
    this._result = { result: val, exception: undefined, isset: true, cancelled: false, wasread: false };
    if (this._then.length > 0)
    {
        this._maybeDispatch();
    }
});

Future.prototype.__defineGetter__("exception", function getException() {
    this._result.wasread = true;
    return this._result.exception;
});

Future.prototype.__defineSetter__("exception", function setException(val) {
    this._result = { result: undefined, exception: val, isset: true, cancelled: false, wasread: false };
    if (this._then.length > 0)
    {
        this._maybeDispatch();
    }
});

module.exports = Future;

