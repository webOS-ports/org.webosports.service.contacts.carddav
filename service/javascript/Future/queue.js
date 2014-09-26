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

/*jslint nomen: true, sloppy: true, white: true, newcap: true, vars: true, continue: true, plusplus: true */

function _SubQ(queue, idx)
{
    this._queue = queue;
    this._idx = idx;
    this._list = [];
}

_SubQ.prototype.defer = function defer(scope, func /* , ... */)
{
    this._list.push({ scope: scope, func: func, args: arguments.length <= 2 ? undefined : Array.prototype.slice.call(arguments, 2) });
    this._queue._dispatch(this._idx);
};

_SubQ.prototype.wrap = function wrap(scope, func)
{
    var self = this;
    return function()
    {
        self._list.push({ scope: scope, func: func, args: arguments });
        self._queue._dispatch(self._idx);
    };
};

_SubQ.prototype._next = function _next()
{
    return this._list.shift();
};

var Queue = {
    _qs: [],
    _start: 0,
    _current: undefined,
    _normal: 1,
    q: function(idx)
    {
        if (idx === undefined)
        {
            idx = this._normal;
        }
        if (!this._qs[idx])
        {
            this._qs[idx] = new _SubQ(this, idx);
        }
        return this._qs[idx];
    },

    defer: function()
    {
        var c = this.current;
        c.defer.apply(c, arguments);
    },

    _dispatch: function(idx)
    {
        if (!this._running)
        {
            this._start = idx;
            var self = this;
            this._running = setTimeout(function dispatch()
                                       {
                while (self._start < self._qs.length)
                {
                    var q = self._qs[self._start];
                    if (q)
                    {
                        var n = q._next();
                        if (n)
                        {
                            self._current = self._start;
                            try
                            {
                                n.func.apply(n.scope, n.args);
                            }
                            catch (e)
                            {
                                console.error(e.stack || e);
                            }
                            self._current = undefined;
                            continue;
                        }
                    }
                    self._start++;
                    // If we're about to start dispatching lower than normal priority calls, we
                    // defer this to process any pending systems calls (which we consider to be higher priority
                    // than what we're about to do).
                    if (self._start > self._normal && self._start < self._qs.length)
                    {
                        self._running = setTimeout(dispatch, 0);
                        return;
                    }
                }
                self._running = undefined;
            }, 0);
        }
        else if (idx < this._start)
        {
            this._start = idx;
        }
    }
};

Queue.__defineGetter__("high", function() {
    return this.q(0);
});

Queue.__defineGetter__("normal", function() {
    return this.q(this._normal);
});

Queue.__defineGetter__("low", function() {
    return this.q(2);
});

Queue.__defineGetter__("current", function() {
    return this.q(this._current);
});

module.exports = Queue;
