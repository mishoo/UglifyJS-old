/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.

  This file defines some constants and utility functions that are used
  in the parser and code generator.

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under a ZLIB license:

    Copyright 2010 (c) Mihai Bazon <mihai.bazon@gmail.com>

    This software is provided 'as-is', without any express or implied
    warranty. In no event will the authors be held liable for any
    damages arising from the use of this software.

    Permission is granted to anyone to use this software for any
    purpose, including commercial applications, and to alter it and
    redistribute it freely, subject to the following restrictions:

    1. The origin of this software must not be misrepresented; you must
       not claim that you wrote the original software. If you use this
       software in a product, an acknowledgment in the product
       documentation would be appreciated but is not required.

    2. Altered source versions must be plainly marked as such, and must
       not be misrepresented as being the original software.

    3. This notice may not be removed or altered from any source
       distribution.

 ***********************************************************************/

/* -----[ Utils ]----- */

function array_to_hash(a) {
        var ret = {};
        for (var i = 0; i < a.length; ++i)
                ret[a[i]] = true;
        return ret;
};
exports.array_to_hash = array_to_hash;

function curry(f) {
        var args = slice(arguments, 1);
        return function() { return f.apply(this, args.concat(slice(arguments))); };
};
exports.curry = curry;

function prog1(ret) {
        if (ret instanceof Function)
                ret = ret();
        for (var i = 1, n = arguments.length; --n > 0; ++i)
                arguments[i]();
        return ret;
};
exports.prog1 = prog1;

function slice(a, start) {
        return Array.prototype.slice.call(a, start == null ? 0 : start);
};
exports.slice = slice;

function characters(str) {
        return str.split("");
};
exports.characters = characters;

function member(name, array) {
        for (var i = array.length; --i >= 0;)
                if (array[i] === name)
                        return true;
        return false;
};
exports.member = member;

function HOP(obj, prop) {
        return Object.prototype.hasOwnProperty.call(obj, prop);
};
exports.HOP = HOP;

function is_alphanumeric_char(ch) {
        ch = ch.charCodeAt(0);
        return (ch >= 48 && ch <= 57) ||
                (ch >= 65 && ch <= 90) ||
                (ch >= 97 && ch <= 122);
};
exports.is_alphanumeric_char = is_alphanumeric_char;

function is_identifier_char(ch) {
        return is_alphanumeric_char(ch) || ch == "$" || ch == "_";
};
exports.is_identifier_char = is_identifier_char;

function is_identifier(name) {
        return /^[a-z_$][a-z0-9_$]*$/i.test(name) &&
                !HOP(KEYWORDS_ATOM, name) &&
                !HOP(RESERVED_WORDS, name) &&
                !HOP(KEYWORDS, name);
};
exports.is_identifier = is_identifier;

function is_digit(ch) {
        ch = ch.charCodeAt(0);
        return ch >= 48 && ch <= 57;
};
exports.is_digit = is_digit;

function repeat_string(str, i) {
        if (i <= 0) return "";
        if (i == 1) return str;
        var d = repeat_string(str, i >> 1);
        d += d;
        if (i & 1) d += str;
        return d;
};
exports.repeat_string = repeat_string;

function defaults(args, defs) {
        var ret = {};
        if (args === true)
                args = {};
        for (var i in defs) if (HOP(defs, i)) {
                ret[i] = (args && HOP(args, i)) ? args[i] : defs[i];
        }
        return ret;
};
exports.defaults = defaults;

function make_deep_copy(src) {
        if (src === null)
                return null;
        if (src instanceof Boolean || src === true || src === false)
                return src;
        if (src instanceof Number || typeof src == "number")
                return src;
        if (src instanceof String || typeof src == "string")
                return src;
        if (src.clone instanceof Function)
                return src.clone();
        if (src instanceof Array)
                return src.map(make_deep_copy);
        if (src instanceof Function)
                return src;
        if (src instanceof Date)
                return new Date(src);
        if (src instanceof Object) {
                var i, dest = {};
                for (i in src) if (HOP(src, i)) {
                        dest[i] = make_deep_copy(src[i]);
                }
                return dest;
        }
        throw new Error("Cannot clone object: " + src);
};
exports.make_deep_copy = make_deep_copy;

/* -----[ Contants ]----- */

var KEYWORDS = array_to_hash([
        "break",
        "case",
        "catch",
        "const",
        "continue",
        "default",
        "delete",
        "do",
        "else",
        "finally",
        "for",
        "function",
        "if",
        "in",
        "instanceof",
        "new",
        "return",
        "switch",
        "throw",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "NaN"
]);
exports.KEYWORDS = KEYWORDS;

var RESERVED_WORDS = array_to_hash([
        "abstract",
        "boolean",
        "byte",
        "char",
        "class",
        "debugger",
        "double",
        "enum",
        "export",
        "extends",
        "final",
        "float",
        "goto",
        "implements",
        "import",
        "int",
        "interface",
        "long",
        "native",
        "package",
        "private",
        "protected",
        "public",
        "short",
        "static",
        "super",
        "synchronized",
        "throws",
        "transient",
        "volatile"
]);
exports.RESERVED_WORDS = RESERVED_WORDS;

var KEYWORDS_BEFORE_EXPRESSION = array_to_hash([
        "return",
        "new",
        "delete",
        "throw",
        "else"
]);
exports.KEYWORDS_BEFORE_EXPRESSION = KEYWORDS_BEFORE_EXPRESSION;

var KEYWORDS_ATOM = array_to_hash([
        "false",
        "null",
        "true",
        "undefined",
        "NaN"
]);
exports.KEYWORDS_ATOM = KEYWORDS_ATOM;

var OPERATOR_CHARS = array_to_hash(characters("+-*&%=<>!?|~^"));
exports.OPERATOR_CHARS = OPERATOR_CHARS;

var OPERATORS = array_to_hash([
        "in",
        "instanceof",
        "typeof",
        "new",
        "void",
        "delete",
        "++",
        "--",
        "+",
        "-",
        "!",
        "~",
        "&",
        "|",
        "^",
        "*",
        "/",
        "%",
        ">>",
        "<<",
        ">>>",
        "<",
        ">",
        "<=",
        ">=",
        "==",
        "===",
        "!=",
        "!==",
        "?",
        "=",
        "+=",
        "-=",
        "/=",
        "*=",
        "%=",
        ">>=",
        "<<=",
        ">>>=",
        "~=",
        "%=",
        "|=",
        "^=",
        "&&",
        "||"
]);
exports.OPERATORS = OPERATORS;

var WHITESPACE_CHARS = array_to_hash(characters(" \n\r\t"));
exports.WHITESPACE_CHARS = WHITESPACE_CHARS;

var PUNC_BEFORE_EXPRESSION = array_to_hash(characters("[{}(,.;:"));
exports.PUNC_BEFORE_EXPRESSION = PUNC_BEFORE_EXPRESSION;

var PUNC_CHARS = array_to_hash(characters("[]{}(),;:"));
exports.PUNC_CHARS = PUNC_CHARS;

var REGEXP_MODIFIERS = array_to_hash(characters("gmsiy"));
exports.REGEXP_MODIFIERS = REGEXP_MODIFIERS;

var UNARY_PREFIX = array_to_hash([
        "typeof",
        "void",
        "delete",
        "--",
        "++",
        "!",
        "~",
        "-",
        "+"
]);
exports.UNARY_PREFIX = UNARY_PREFIX;

var UNARY_POSTFIX = array_to_hash([ "--", "++" ]);
exports.UNARY_POSTFIX = UNARY_POSTFIX;

var ASSIGNMENT = (function(a, ret, i){
        while (i < a.length) {
                ret[a[i]] = a[i].substr(0, a[i].length - 1);
                i++;
        }
        return ret;
})(
        ["+=", "-=", "/=", "*=", "%=", ">>=", "<<=", ">>>=", "~=", "%=", "|=", "^="],
        { "=": true },
        0
);
exports.ASSIGNMENT = ASSIGNMENT;

var PRECEDENCE = (function(a, ret){
        for (var i = 0, n = 1; i < a.length; ++i, ++n) {
                var b = a[i];
                for (var j = 0; j < b.length; ++j) {
                        ret[b[j]] = n;
                }
        }
        return ret;
})(
        [
                ["||"],
                ["&&"],
                ["|"],
                ["^"],
                ["&"],
                ["==", "===", "!=", "!=="],
                ["<", ">", "<=", ">=", "in", "instanceof"],
                [">>", "<<", ">>>"],
                ["+", "-"],
                ["*", "/", "%"]
        ],
        {}
);
exports.PRECEDENCE = PRECEDENCE;

var STATEMENTS_WITH_LABELS = array_to_hash([ "for", "do", "while", "switch" ]);
exports.STATEMENTS_WITH_LABELS = STATEMENTS_WITH_LABELS;

var ATOMIC_START_TOKEN = array_to_hash([ "atom", "num", "string", "regexp", "name" ]);
exports.ATOMIC_START_TOKEN = ATOMIC_START_TOKEN;
