/**
 * helper to check result of futures with catching exceptions
 * because futures can "transport" exceptions to waiting
 * functions.
 * Using this small function should allow V8 to optimize the other functions,
 * because functions including try-catch can not be optimized currently.
 * @param future the future whose result to parse
 * @return the result, returnValue = false hints to error, check exception fiel for future exception
 */
function checkResult(future) {
    "use strict";
    var exception = future.exception;
    if (exception) {
        return {returnValue: false, exception: future.exception};
    }
    //else
    return future.result;
}

module.exports = checkResult;
