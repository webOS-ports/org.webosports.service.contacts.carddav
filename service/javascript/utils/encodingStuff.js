//TODO: this definitively needs a cleanup from someone knowing what he is doing... :(

//Simple base64 encoder/decoder using node buffers
var Base64 = {
    encode : function (utf8Data) {
        var localBase64 = new Buffer(utf8Data, 'utf8');
        return localBase64.toString('base64');
    },

    decode : function (base64Data) {
        var localUTF8 = new Buffer(base64Data, 'base64');
        return localUTF8.toString('utf8');
    }
};

function decode_utf8(s) {
    return decodeURIComponent(escape(s));
}

function encode_utf8(s) {
    return unescape(encodeURIComponent(s));
}

function quoted_printable_decode(str) {
    // Convert a quoted-printable string to an 8 bit string
    //
    // version: 1109.2015
    // discuss at: http://phpjs.org/functions/quoted_printable_decode    // +   original by: Ole Vrijenhoek
    // +   bugfixed by: Brett Zamir (http://brett-zamir.me)
    // +   reimplemented by: Theriault
    // +   improved by: Brett Zamir (http://brett-zamir.me)
    // +   bugfixed by: Theriault    // *     example 1: quoted_printable_decode('a=3Db=3Dc');
    // *     returns 1: 'a=b=c'
    // *     example 2: quoted_printable_decode('abc  =20\r\n123  =20\r\n');
    // *     returns 2: 'abc   \r\n123   \r\n'
    // *     example 3: quoted_printable_decode('012345678901234567890123456789012345678901234567890123456789012345678901234=\r\n56789');
    // *     returns 3: '01234567890123456789012345678901234567890123456789012345678901234567890123456789'
    // *    example 4: quoted_printable_decode("Lorem ipsum dolor sit amet=23, consectetur adipisicing elit");
    // *    returns 4: Lorem ipsum dolor sit amet#, consectetur adipisicing elit
    // Removes softline breaks
    var RFC2045Decode1 = /\=\r\n/gm,        // Decodes all equal signs followed by two hex digits
        RFC2045Decode2IN = /\=([0-9A-F]{2})/gim,
    // the RFC states against decoding lower case encodings, but following apparent PHP behavior
    // RFC2045Decode2IN = /=([0-9A-F]{2})/gm,
        RFC2045Decode2OUT = function (sMatch, sHex) {
            return String.fromCharCode(parseInt(sHex, 16));
        };
    return decode_utf8(str.replace(RFC2045Decode1, '').replace(RFC2045Decode2IN, RFC2045Decode2OUT));
}

function quoted_printable_encode (str) {
    str = encode_utf8(str);
    // +   original by: Theriault
    // +   improved by: Brett Zamir (http://brett-zamir.me)
    // +   improved by: Theriault
    // *     example 1: quoted_printable_encode('a=b=c');
    // *     returns 1: 'a=3Db=3Dc'
    // *     example 2: quoted_printable_encode('abc   \r\n123   \r\n');
    // *     returns 2: 'abc  =20\r\n123  =20\r\n'
    // *     example 3: quoted_printable_encode('0123456789012345678901234567890123456789012345678901234567890123456789012345');
    // *     returns 3: '012345678901234567890123456789012345678901234567890123456789012345678901234=\r\n5'
    // RFC 2045: 6.7.2: Octets with decimal values of 33 through 60 (bang to less-than) inclusive, and 62 through 126 (greater-than to tilde), inclusive, MAY be represented as the US-ASCII characters
    // PHP does not encode any of the above; as does this function.
    // RFC 2045: 6.7.3: Octets with values of 9 and 32 MAY be represented as US-ASCII TAB (HT) and SPACE characters, respectively, but MUST NOT be so represented at the end of an encoded line
    // PHP does not encode spaces (octet 32) except before a CRLF sequence as stated above. PHP always encodes tabs (octet 9). This function replicates PHP.
    // RFC 2045: 6.7.4: A line break in a text body, represented as a CRLF sequence in the text canonical form, must be represented by a (RFC 822) line break
    // PHP does not encode a CRLF sequence, as does this function.
    // RFC 2045: 6.7.5: The Quoted-Printable encoding REQUIRES that encoded lines be no more than 76 characters long. If longer lines are to be encoded with the Quoted-Printable encoding, "soft" line breaks must be used.
    // PHP breaks lines greater than 76 characters; as does this function.
    var hexChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'],
        RFC2045Encode1IN = / \r\n|\r\n|[^!-<>-~ ]/gm,
        RFC2045Encode1OUT = function (sMatch) {
            // Encode space before CRLF sequence to prevent spaces from being stripped
            // Keep hard line breaks intact; CRLF sequences
            if (sMatch.length > 1) {
                return sMatch.replace(' ', '=20');
            }
            // Encode matching character
            var chr = sMatch.charCodeAt(0);
            return '=' + hexChars[((chr >>> 4) & 15)] + hexChars[(chr & 15)];
        },
        // Split lines to 75 characters; the reason it's 75 and not 76 is because softline breaks are preceeded by an equal sign; which would be the 76th character.
        // However, if the last line/string was exactly 76 characters, then a softline would not be needed. PHP currently softbreaks anyway; so this function replicates PHP.
        RFC2045Encode2IN = /.{1,72}(?!\r\n)[^=]{0,3}/g,
        RFC2045Encode2OUT = function (sMatch) {
            if (sMatch.substr(sMatch.length - 2) === '\r\n') {
                return sMatch;
            }
            return sMatch + '=\r\n';
        };
    str = str.replace(RFC2045Encode1IN, RFC2045Encode1OUT).replace(RFC2045Encode2IN, RFC2045Encode2OUT);
    // Strip last softline break
    return str.substr(0, str.length - 3);
}

function unquote(string) {
    if (string === undefined || string === null || typeof (string) !== "string") {
        return string;
    }
    string = string.replace(/\\\\/gmi, '\\');
    string = string.replace(/\\,/gmi, ',');
    string = string.replace(/\\;/gmi, ';');
    string = string.replace(/\\n/gmi, '\n');
    string = string.replace(/\\r/gmi, '\r');
    string = string.replace(/&amp;/gmi, "&");
    string = string.replace(/&lt;/gmi, "<");
    string = string.replace(/&gt;/gmi, ">");
    string = string.replace(/&quot;/gmi, "\"");
    string = string.replace(/&apos;/gmi, "'");
    return string;
}

function quote(string) {
    if (string === undefined || string === null || typeof (string) !== "string") {
        return string;
    }
    string = string.replace(/\\/gmi, "\\\\");
    string = string.replace(/,/gmi, "\\,");
    string = string.replace(/;/gmi, "\\;");
    string = string.replace(/\n/gmi, "\\n");
    string = string.replace(/\r/gmi, "\\r");
    //we don't need them, because we are not using XML anymore, yeah :)
    /*string = string.replace(/&/gmi, "&amp;");
    string = string.replace(/</gmi, "&lt;");
    string = string.replace(/>/gmi, "&gt;");
    string = string.replace(/"/gmi, "&quot;");
    string = string.replace(/'/gmi, "&apos;");*/
    return string;
}

function fold(string) {
    var parts = [];
    while (string.length > 72) {
        parts.push(string.substring(0, 72) + "\n\r ");
        string = string.substring(72);
    }
    parts.push(string);
    return parts.join("");
}