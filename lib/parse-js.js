/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.

  This version is suitable for Node.js.
  With minimal changes it should work on any JS platform.

  Exported functions:

    - tokenizer(code) -- returns a function.  Call the returned
      function to fetch the next token.

    - parse(code) -- returns an AST of the given JavaScript code.

    - gen_code(ast, beautify) -- returns the JavaScript code for the
      given abstract syntax tree.

  --------------------------------(C)-----------------------------------

                      Copyright Mihai Bazon 2010
                       <mihai.bazon@gmail.com>
                     http://mihai.bazon.net/blog

  The tokenizer/parser (the "meat" in this package) is a direct port
  to JavaScript of Marijn Haverbeke's "parse-js" Common Lisp library:
  http://marijn.haverbeke.nl/parse-js/ -- thank you Marijn!

  Distributed under the same terms as the original code (ZLIB license):
  http://marijn.haverbeke.nl/parse-js/LICENSE

 ***********************************************************************/

/* -----[ Tokenizer (constants) ]----- */

var KEYWORDS = array_to_hash([
        "break",
        "case",
        "catch",
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

var RESERVED_WORDS = array_to_hash([
        "abstract",
        "boolean",
        "byte",
        "char",
        "class",
        "const",
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

var KEYWORDS_BEFORE_EXPRESSION = array_to_hash([
        "return",
        "new",
        "delete",
        "throw"
]);

var KEYWORDS_ATOM = array_to_hash([
        "false",
        "null",
        "true",
        "undefined",
        "NaN"
]);

var OPERATOR_CHARS = array_to_hash(characters("+-*&%=<>!?|~^"));

var RE_HEX_NUMBER = /^0x[0-9a-f]+$/i;
var RE_OCT_NUMBER = /^0[0-7]+$/;
var RE_DEC_NUMBER = /^\d*\.?\d*(?:e-?\d*(?:\d\.?|\.?\d)\d*)?$/i;

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

var WHITESPACE_CHARS = array_to_hash(characters(" \n\r\t"));

var PUNC_BEFORE_EXPRESSION = array_to_hash(characters("[{}(,.;:"));

var PUNC_CHARS = array_to_hash(characters("[]{}(),.;:"));

var REGEXP_MODIFIERS = array_to_hash(characters("gmsiy"));

/* -----[ Tokenizer ]----- */

function is_alphanumeric_char(ch) {
        ch = ch.charCodeAt(0);
        return (ch >= 48 && ch <= 57) ||
                (ch >= 65 && ch <= 90) ||
                (ch >= 97 && ch <= 122);
};

function is_identifier_char(ch) {
        return is_alphanumeric_char(ch) || ch == "$" || ch == "_";
};

function is_digit(ch) {
        ch = ch.charCodeAt(0);
        return ch >= 48 && ch <= 57;
};

function parse_js_number(num) {
        if (RE_HEX_NUMBER.test(num)) {
                return parseInt(num.substr(2), 16);
        } else if (RE_OCT_NUMBER.test(num)) {
                return parseInt(num.substr(1), 8);
        } else if (RE_DEC_NUMBER.test(num)) {
                return parseFloat(num);
        }
};

function JS_Parse_Error(message, line, col, pos) {
        this.message = message;
        this.line = line;
        this.col = col;
        this.pos = pos;
        try {
                ({})();
        } catch(ex) {
                this.stack = ex.stack;
        };
};

JS_Parse_Error.prototype.toString = function() {
        return this.message + " (line: " + this.line + ", col: " + this.col + ", pos: " + this.pos + ")" + "\n\n" + this.stack;
};

function js_error(message, line, col, pos) {
        throw new JS_Parse_Error(message, line, col, pos);
};

function is_token(token, type, val) {
        return token.type == type && (val == null || token.value == val);
};

var EX_EOF = {};

function tokenizer($TEXT, skip_comments) {

        var S = {
                text           : $TEXT,
                pos            : 0,
                tokpos         : 0,
                line           : 0,
                tokline        : 0,
                col            : 0,
                tokcol         : 0,
                newline_before : false,
                regex_allowed  : false
        };

        function peek() { return S.text.charAt(S.pos); };

        function next(signal_eof) {
                var ch = S.text.charAt(S.pos++);
                if (signal_eof && !ch)
                        throw EX_EOF;
                if (ch == "\n") {
                        S.newline_before = true;
                        ++S.line;
                        S.col = 0;
                } else {
                        ++S.col;
                }
                return ch;
        };

        function eof() {
                return !S.peek();
        };

        function find(what, signal_eof) {
                var pos = S.text.indexOf(what, S.pos);
                if (signal_eof && pos == -1) throw EX_EOF;
                return pos;
        };

        function start_token() {
                S.tokline = S.line;
                S.tokcol = S.col;
                S.tokpos = S.pos;
        };

        function token(type, value) {
                S.regex_allowed = (type == "operator" ||
                                   (type == "keyword" && value in KEYWORDS_BEFORE_EXPRESSION) ||
                                   (type == "punc" && value in PUNC_BEFORE_EXPRESSION));
                var ret = {
                        type  : type,
                        value : value,
                        line  : S.tokline,
                        col   : S.tokcol,
                        pos   : S.tokpos,
                        nlb   : S.newline_before
                };
                S.newline_before = false;
                return ret;
        };

        function skip_whitespace() {
                while (peek() in WHITESPACE_CHARS)
                        next();
        };

        function read_while(pred) {
                var ret = "", ch = peek(), i = 0;
                while (ch && pred(ch, i++)) {
                        ret += next();
                        ch = peek();
                }
                return ret;
        };

        function parse_error(err) {
                js_error(err, S.tokline, S.tokcol, S.tokpos);
        };

        function read_num(prefix) {
                var num = read_while(function(ch, i){
                        return is_alphanumeric_char(ch) || ch == "." || (i == 0 && ch == "-");
                });
                if (prefix)
                        num = prefix + num;
                var valid = parse_js_number(num);
                if (!isNaN(valid)) {
                        return token("num", valid);
                } else {
                        parse_error("Invalid syntax: " + num);
                }
        };

        function read_escaped_char() {
                var ch = next(true);
                switch (ch) {
                    case "n" : return "\n";
                    case "r" : return "\r";
                    case "t" : return "\t";
                    case "b" : return "\b";
                    case "v" : return "\v";
                    case "f" : return "\f";
                    case "0" : return "\0";
                    case "x" : return String.fromCharCode(hex_bytes(2));
                    case "u" : return String.fromCharCode(hex_bytes(4));
                    default  : return ch;
                }
        };

        function hex_bytes(n) {
                var num = 0;
                for (; n > 0; --n) {
                        var digit = parseInt(next(true), 16);
                        if (isNaN(digit))
                                parse_error("Invalid hex-character pattern in string");
                        num = (num << 4) | digit;
                }
                return num;
        };

        function read_string() {
                return with_eof_error("Unterminated string constant", function(){
                        var quote = next(), ret = "";
                        for (;;) {
                                var ch = next(true);
                                if (ch == "\\") ch = read_escaped_char();
                                else if (ch == quote) break;
                                ret += ch;
                        }
                        return token("string", ret);
                });
        };

        function read_line_comment() {
                next();
                var i = find("\n"), ret;
                if (i == -1) {
                        ret = S.text.substr(S.pos);
                        S.pos = S.text.length;
                } else {
                        ret = S.text.substring(S.pos, i);
                        S.pos = i + 1;
                }
                return token("comment1", ret);
        };

        function read_multiline_comment() {
                next();
                return with_eof_error("Unterminated multiline comment", function(){
                        var i = find("*/", true), ret = S.text.substring(S.pos, i);
                        S.pos = i + 2;
                        return token("comment2", ret);
                });
        };

        function read_regexp() {
                return with_eof_error("Unterminated regular expression", function(){
                        var prev_backslash = false, regexp = "", ch;
                        while ((ch = next(true))) if (prev_backslash) {
                                regexp += "\\" + ch;
                                prev_backslash = false;
                        } else if (ch == "/") {
                                break;
                        } else if (ch == "\\") {
                                prev_backslash = true;
                        } else {
                                regexp += ch;
                        }
                        var mods = read_while(function(ch){
                                return ch in REGEXP_MODIFIERS;
                        });
                        return token("regexp", [ regexp, mods ]);
                });
        };

        function read_operator(prefix) {
                function grow(op) {
                        var bigger = op + peek();
                        if (bigger in OPERATORS) {
                                next();
                                return grow(bigger);
                        } else {
                                return op;
                        }
                };
                return token("operator", grow(prefix || next()));
        };

        var handle_slash = skip_comments ? function() {
                next();
                switch (peek()) {
                    case "/": read_line_comment(); return next_token();
                    case "*": read_multiline_comment(); return next_token();
                }
                return S.regex_allowed ? read_regexp() : read_operator("/");
        } : function() {
                next();
                switch (peek()) {
                    case "/": return read_line_comment();
                    case "*": return read_multiline_comment();
                }
                return S.regex_allowed ? read_regexp() : read_operator("/");
        };

        function handle_dot() {
                next();
                return is_digit(peek())
                        ? read_num(".")
                        : token("punc", ".");
        };

        function read_word() {
                var word = read_while(is_identifier_char);
                return !(word in KEYWORDS)
                        ? token("name", word)
                        : word in OPERATORS
                        ? token("operator", word)
                        : word in KEYWORDS_ATOM
                        ? token("atom", word)
                        : token("keyword", word);
        };

        function with_eof_error(eof_error, cont) {
                try {
                        return cont();
                } catch(ex) {
                        if (ex === EX_EOF) parse_error(eof_error);
                        else throw ex;
                }
        };

        function next_token() {
                skip_whitespace();
                start_token();
                var ch = peek();
                if (!ch) return token("eof");
                if (is_digit(ch)) return read_num();
                if (ch == '"' || ch == "'") return read_string();
                if (ch in PUNC_CHARS) return token("punc", next());
                if (ch == ".") return handle_dot();
                if (ch == "/") return handle_slash();
                if (ch in OPERATOR_CHARS) return read_operator();
                if (is_identifier_char(ch)) return read_word();
                parse_error("Unexpected character '" + ch + "'");
        };

        next_token.context = function(nc) {
                if (nc) S = nc;
                return S;
        };

        return next_token;

};

/* -----[ Parser (constants) ]----- */

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

var UNARY_POSTFIX = array_to_hash([ "--", "++" ]);

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

var STATEMENTS_WITH_LABELS = array_to_hash([ "for", "do", "while", "switch" ]);

var ATOMIC_START_TOKEN = array_to_hash([ "atom", "num", "string", "regexp", "name" ]);

/* -----[ Parser ]----- */

function NodeWithToken(str, start, end) {
        this.name = str;
        this.start = start;
        this.end = end;
};

NodeWithToken.prototype.toString = function() { return this.name; };

function parse($TEXT, strict_semicolons, embed_tokens) {

        var S = {
                input: tokenizer($TEXT, true),
                token: null,
                prev: null,
                peeked: null,
                in_function: 0,
                in_loop: 0,
                labels: []
        };

        S.token = next();

        function is(type, value) {
                return is_token(S.token, type, value);
        };

        function peek() { return S.peeked || (S.peeked = S.input()); };

        function next() {
                S.prev = S.token;
                if (S.peeked) {
                        S.token = S.peeked;
                        S.peeked = null;
                } else {
                        S.token = S.input();
                }
                return S.token;
        };

        function prev() {
                return S.prev;
        };

        function croak(msg, line, col, pos) {
                var ctx = S.input.context();
                js_error(msg,
                         line != null ? line : ctx.tokline,
                         col != null ? col : ctx.tokcol,
                         pos != null ? pos : ctx.tokpos);
        };

        function token_error(token, msg) {
                croak(msg, token.line, token.col);
        };

        function unexpected(token) {
                if (token == null)
                        token = S.token;
                token_error(token, "Unexpected token: " + token.type + " (" + token.value + ")");
        };

        function expect_token(type, val) {
                if (is(type, val)) {
                        return next();
                }
                token_error(S.token, "Unexpected token " + S.token.type + ", expected " + type);
        };

        function expect(punc) { return expect_token("punc", punc); };

        function semicolon() {
                if (strict_semicolons) return expect(";");
                if (is("punc", ";")) return next();
                if (!(S.token.nlb || is("eof") || is("punc", "}")))
                        unexpected();
        };

        function as() {
                return slice(arguments);
        };

        function parenthesised() {
                expect("(");
                var ex = expression();
                expect(")");
                return ex;
        };

        function maybe_before_semicolon(func) {
                if (is("punc", ";")) {
                        next();
                        return null;
                }
                if (is("punc", "}")) return null;
                var start = S.token;
                try {
                        return prog1(func, semicolon);
                } catch(ex) {
                        if (ex instanceof JS_Parse_Error) {
                                if ((S.token === start) && S.token.nlb && !strict_semicolons)
                                        return null;
                        }
                        throw ex;
                }
        };

        function add_tokens(str, start, end) {
                return new NodeWithToken(str, start, end);
        };

        var statement = embed_tokens ? function(allow_case) {
                var start = S.token;
                var stmt = $statement(allow_case);
                stmt[0] = add_tokens(stmt[0], start, prev());
                return stmt;
        } : $statement;

        function $statement(allow_case) {
                switch (S.token.type) {
                    case "num":
                    case "string":
                    case "regexp":
                    case "operator":
                    case "atom":
                        return simple_statement();

                    case "name":
                        return is_token(peek(), "punc", ":")
                                ? labeled_statement(prog1(S.token.value, next, next))
                                : simple_statement();

                    case "punc":
                        switch (S.token.value) {
                            case "{":
                                next();
                                return block();
                            case "[":
                            case "(":
                                return simple_statement();
                            case ";":
                                next();
                                return as("block");
                            default:
                                unexpected();
                        }

                    case "keyword":
                        switch (prog1(S.token.value, next)) {
                            case "break":
                                return break_cont("break");

                            case "continue":
                                return break_cont("continue");

                            case "case":
                                if (!allow_case)
                                        unexpected();
                                return as("case", prog1(expression, curry(expect, ":")));

                            case "debugger":
                                semicolon();
                                return as("debugger");

                            case "default":
                                if (!allow_case)
                                        unexpected();
                                expect(":");
                                return as("default");

                            case "do":
                                return (function(body){
                                        expect_token("keyword", "while");
                                        return as("do", prog1(parenthesised, semicolon), body);
                                })(in_loop(statement));

                            case "for":
                                return for_();

                            case "function":
                                return function_(true);

                            case "if":
                                return if_();

                            case "return":
                                if (S.in_function == 0)
                                        croak("'return' outside of function");
                                return as("return", maybe_before_semicolon(expression));

                            case "switch":
                                return as("switch",
                                          prog1(parenthesised, curry(expect, "{")),
                                          prog1(curry(in_loop, function(){
                                                  var a = [];
                                                  while (!is("punc", "}"))
                                                          a.push(statement(true));
                                                  return a;
                                          }), next));

                            case "throw":
                                return as("throw", prog1(expression, semicolon));

                            case "try":
                                return try_();

                            case "var":
                                return prog1(var_, semicolon);

                            case "while":
                                return as("while", parenthesised(), in_loop(statement));

                            case "with":
                                return as("with", parenthesised(), statement());

                            default:
                                unexpected();
                        }
                }
        };

        function labeled_statement(label) {
                S.labels.push(label);
                var start = S.token, stat = statement();
                if (!(stat[0] in STATEMENTS_WITH_LABELS))
                        unexpected(start);
                S.labels.pop();
                return as("label", label, stat);
        };

        function simple_statement() {
                return as("stat", prog1(expression, semicolon));
        };

        function break_cont(type) {
                if (S.in_loop == 0)
                        croak(type + " not inside a loop or switch");
                var name = is("name") ? S.token.value : null;
                if (name != null) {
                        next();
                        if (!member(name, S.labels))
                                croak("Label " + name + " without matching loop or statement");
                }
                semicolon();
                return as(type, name);
        };

        function block() {
                var a = [];
                while (!is("punc", "}"))
                        a.push(statement());
                next();
                return as("block", a);
        };

        function for_() {
                expect("(");
                var has_var = is("keyword", "var");
                if (has_var)
                        next();
                if (is("name") && is_token(peek(), "operator", "in")) {
                        // for (i in foo)
                        var name = S.token.value;
                        next(); next();
                        var obj = expression();
                        expect(")");
                        return as("for-in", has_var, name, obj, in_loop(statement));
                } else {
                        // classic for
                        var init = maybe_before_semicolon(has_var ? var_ : expression);
                        var test = maybe_before_semicolon(expression);
                        var step = is("punc", ")") ? null : expression();
                        expect(")");
                        return as("for", init, test, step, in_loop(statement));
                }
        };

        function function_(in_statement) {
                var name = is("name") ? prog1(S.token.value, next) : null;
                if (in_statement && !name)
                        unexpected();
                expect("(");
                var argnames = (function(first, a){
                        while (!is("punc", ")")) {
                                if (first) first = false; else expect(",");
                                if (!is("name")) unexpected();
                                a.push(S.token.value);
                                next();
                        }
                        return a;
                })(true, []);
                next();
                expect("{");
                var body = (function(a){
                        ++S.in_function;
                        while (!is("punc", "}"))
                                a.push(statement());
                        --S.in_function;
                        next();
                        return a;
                })([]);
                return as(in_statement ? "defun" : "function", name, argnames, body);
        };

        function if_() {
                var cond = parenthesised(), body = statement(), belse;
                if (is("keyword", "else")) {
                        next();
                        belse = statement();
                }
                return as("if", cond, body, belse);
        };

        function try_() {
                var body = statement(), bcatch, bfinally;
                if (is("keyword", "catch")) {
                        next();
                        expect("(");
                        if (!is("name"))
                                croak("Name expected");
                        var name = S.token.value;
                        next();
                        expect(")");
                        bcatch = [ name, statement() ];
                }
                if (is("keyword", "finally")) {
                        next();
                        bfinally = statement();
                }
                return as("try", body, bcatch, bfinally);
        };

        function vardefs() {
                var a = [];
                for (;;) {
                        if (!is("name"))
                                unexpected();
                        var name = S.token.value;
                        next();
                        if (is("operator", "=")) {
                                next();
                                a.push([ name, expression(false) ]);
                        } else {
                                a.push([ name ]);
                        }
                        if (!is("punc", ","))
                                break;
                        next();
                }
                return a;
        };

        function var_() {
                return as("var", vardefs());
        };

        function new_() {
                var newexp = expr_atom(false), args;
                if (is("punc", "(")) {
                        next();
                        args = expr_list(")");
                } else {
                        args = [];
                }
                return subscripts(as("new", newexp, args), true);
        };

        function expr_atom(allow_calls) {
                if (is("operator", "new")) {
                        next();
                        return new_();
                }
                if (is("operator") && S.token.value in UNARY_PREFIX) {
                        return make_unary("unary-prefix",
                                          prog1(S.token.value, next),
                                          expr_atom(allow_calls));
                }
                if (is("punc")) {
                        switch (S.token.value) {
                            case "(":
                                next();
                                return subscripts(prog1(expression, curry(expect, ")")), allow_calls);
                            case "[":
                                next();
                                return subscripts(array_(), allow_calls);
                            case "{":
                                next();
                                return subscripts(object_(), allow_calls);
                        }
                        unexpected();
                }
                if (is("keyword", "function")) {
                        next();
                        return subscripts(function_(false), allow_calls);
                }
                if (S.token.type in ATOMIC_START_TOKEN) {
                        var atom = S.token.type == "regexp"
                                ? as("regexp", S.token.value[0], S.token.value[1])
                                : as(S.token.type, S.token.value);
                        return subscripts(prog1(atom, next), allow_calls);
                }
                unexpected();
        };

        function expr_list(closing) {
                var first = true, a = [];
                while (!is("punc", closing)) {
                        if (first) first = false; else expect(",");
                        a.push(expression(false));
                }
                next();
                return a;
        };

        function array_() {
                return as("array", expr_list("]"));
        };

        function object_() {
                return as("object", (function(first, a){
                        while (!is("punc", "}")) {
                                if (first) first = false; else expect(",");
                                var name = as_property_name();
                                expect(":");
                                var value = expression(false);
                                a.push([ name, value ]);
                        }
                        next();
                        return a;
                })(true, []));
        };

        function as_property_name() {
                switch (S.token.type) {
                    case "num":
                    case "string":
                        return prog1(S.token.value, next);
                }
                return as_name();
        };

        function as_name() {
                switch (S.token.type) {
                    case "name":
                    case "operator":
                    case "keyword":
                    case "atom":
                        return prog1(S.token.value, next);
                    default:
                        unexpected();
                }
        };

        function subscripts(expr, allow_calls) {
                if (is("punc", ".")) {
                        next();
                        return subscripts(as("dot", expr, as_name()), allow_calls);
                }
                if (is("punc", "[")) {
                        next();
                        return subscripts(as("sub", expr, prog1(expression, curry(expect, "]"))), allow_calls);
                }
                if (allow_calls && is("punc", "(")) {
                        next();
                        return subscripts(as("call", expr, expr_list(")")), true);
                }
                if (allow_calls && is("operator") && S.token.value in UNARY_POSTFIX) {
                        return prog1(curry(make_unary, "unary-postfix", S.token.value, expr),
                                     next);
                }
                return expr;
        };

        function make_unary(tag, op, expr) {
                if ((op == "++" || op == "--") && !is_assignable(expr))
                        croak("Invalid use of " + op + " operator");
                return as(tag, op, expr);
        };

        function expr_op(left, min_prec) {
                var op = is("operator") ? S.token.value : null;
                var prec = op != null ? PRECEDENCE[op] : null;
                if (prec != null && prec > min_prec) {
                        next();
                        var right = expr_op(expr_atom(true), prec);
                        return expr_op(as("binary", op, left, right), min_prec);
                }
                return left;
        };

        function expr_ops() {
                return expr_op(expr_atom(true), 0);
        };

        function maybe_conditional() {
                var expr = expr_ops();
                if (is("operator", "?")) {
                        next();
                        var yes = expr_ops();
                        expect(":");
                        return as("conditional", expr, yes, maybe_conditional());
                }
                return expr;
        };

        function is_assignable(expr) {
                expr = expr[0];
                return expr == "name" || expr == "dot" || expr == "sub";
        };

        function maybe_assign() {
                var left = maybe_conditional(), val = S.token.value;
                if (is("operator") && val in ASSIGNMENT) {
                        if (is_assignable(left)) {
                                next();
                                return as("assign", ASSIGNMENT[val], left, maybe_assign());
                        }
                        croak("Invalid assignment");
                }
                return left;
        };

        function expression(commas) {
                if (arguments.length == 0)
                        commas = true;
                var expr = maybe_assign();
                if (commas && is("punc", ",")) {
                        next();
                        return as("seq", expr, expression());
                }
                return expr;
        };

        function in_loop(cont) {
                try {
                        ++S.in_loop;
                        return cont();
                } finally {
                        --S.in_loop;
                }
        };

        return as("toplevel", (function(a){
                while (!is("eof"))
                        a.push(statement());
                return a;
        })([]));

};

/* -----[ re-generate code from the AST ]----- */

var DOT_CALL_NO_PARENS = array_to_hash([
        "name",
        "string",
        "dot",
        "sub",
        "call"
]);

var AVOID_SEMICOLON_AFTER = array_to_hash([
        "if",
        "for",
        "for-in",
        "switch",
        "while",
        "do",
        "case",
        "default",
        "label",
        "function"
]);

function gen_code(ast, beautify) {
        var indentation = 0;
        var indent_start = beautify ? beautify.indent_start || 0 : 0;
        var indent_level = beautify ? beautify.indent_level || 4 : null;
        var newline = beautify ? "\n" : "";
        var space = beautify ? " " : "";

        function indent(line) {
                if (line == null)
                        line = "";
                if (beautify)
                        line = repeat_string(" ", indent_start + indentation * indent_level) + line;
                return line;
        };

        function with_indent(cont, incr) {
                if (incr == null) incr = 1;
                indentation += incr;
                try { return cont.apply(null, slice(arguments, 1)); }
                finally { indentation -= incr; }
        };

        function add_spaces() {
                var a = arguments[0] instanceof Array
                        ? arguments[0]
                        : slice(arguments);
                if (beautify)
                        return a.join(" ");
                var b = [];
                for (var i = 0; i < a.length; ++i) {
                        var next = a[i + 1];
                        b.push(a[i]);
                        if (next &&
                            /[a-z0-9_\x24]$/i.test(a[i].toString()) &&
                            /^[a-z0-9_\x24]/i.test(next.toString())) {
                                b.push(" ");
                        }
                }
                return b.join("");
        };

        function add_commas() {
                var a = arguments[0] instanceof Array
                        ? arguments[0]
                        : slice(arguments);
                return a.join("," + space);
        };

        function add_semicolons(a) {
                return a.join(";" + space);
        };

        function is_semicolon(el) { return el == ";"; };

        var generators = {
                "string": make_string,
                "num": function(num) {
                        return String(num);
                },
                "name": make_name,
                "toplevel": function(statements) {
                        return make_block_statements(statements)
                                .map(indent)
                                .join(newline + newline);
                },
                "block": make_block,
                "var": function(defs) {
                        return "var " + make_vardefs(defs);
                },
                "try": function(the_try, the_catch, the_finally) {
                        var out = [ "try", make(the_try) ];
                        if (the_catch)
                                out.push("catch", "(" + the_catch[0] + ")", make(the_catch[1]));
                        if (the_finally)
                                out.push("finally", make(the_finally));
                        return add_spaces(out);
                },
                "throw": function(expr) {
                        return add_spaces("throw", make(expr));
                },
                "new": function(ctor, args) {
                        return add_spaces("new", make(ctor) + "(" + add_commas(args.map(make)) + ")");
                },
                "switch": function(expr, body) {
                        return add_spaces("switch", "(" + make(expr) + ")", make_block(body));
                },
                "case": function(expr) {
                        return add_spaces("\x08case", make(expr) + ":");
                },
                "default": function() {
                        return "\x08default:";
                },
                "break": function(label) {
                        var out = "break";
                        if (label != null)
                                out += " " + make_name(label);
                        return out;
                },
                "continue": function(label) {
                        var out = "continue";
                        if (label != null)
                                out += " " + make_name(label);
                        return out;
                },
                "conditional": function(cond, the_then, the_else) {
                        return add_spaces(make(cond), "?", make(the_then), ":", make(the_else));
                },
                "assign": function(op, lvalue, rvalue) {
                        if (op && op !== true) op += "=";
                        else op = "=";
                        return add_spaces(make(lvalue), op, make(rvalue));
                },
                "dot": function(expr) {
                        var out = make(expr), i = 1;
                        if (!(expr[0] in DOT_CALL_NO_PARENS))
                                out = "(" + out + ")";
                        while (i < arguments.length)
                                out += "." + make_name(arguments[i++]);
                        return out;
                },
                "call": function(func, args) {
                        switch (func[0]) {
                            case "function": // calling a literal function, need to put it into parens
                            case "object": // calling a literal object doesn't make sense, but it's syntactically valid
                                return "(" + make(func) + ")(" + add_commas(args.map(make)) + ")";
                            default:
                                return make(func) + "(" + add_commas(args.map(make)) + ")";
                        }
                },
                "function": make_function,
                "defun": make_function,
                "if": function(condition, the_then, the_else) {
                        condition = make(condition);
                        the_then = make(the_then);
                        if (the_else) {
                                the_else = make(the_else);
                                if (!/[;\}]\s*$/.test(the_then))
                                        the_then += ";";
                        }
                        var out = [ "if", "(" + condition + ")", the_then ];
                        if (the_else) {
                                out.push("else", the_else);
                        }
                        return add_spaces(out);
                },
                "for": function(init, cond, step, block) {
                        var out = [ "for" ];
                        var args = add_semicolons([
                                init != null ? make(init) : "",
                                cond != null ? make(cond) : "",
                                step != null ? make(step) : ""
                        ]);
                        if (args == "; ; ") args = ";;";
                        out.push("(" + args + ")", make(block));
                        return add_spaces(out);
                },
                "for-in": function(has_var, key, hash, block) {
                        var out = add_spaces("for", "(");
                        if (has_var)
                                out += "var ";
                        out += add_spaces(make_name(key) + " in " + make(hash) + ")", make(block));
                        return out;
                },
                "while": function(condition, block) {
                        return add_spaces("while", "(" + make(condition) + ")", make(block));
                },
                "do": function(condition, block) {
                        return add_spaces("do", make(block), "while", "(" + make(condition) + ")");
                },
                "return": function(expr) {
                        return add_spaces("return", make(expr));
                },
                "binary": function(operator, lvalue, rvalue) {
                        var left = make(lvalue), right = make(rvalue);
                        // XXX: I'm pretty sure other cases will bite here.
                        //      we need to be smarter.
                        //      adding parens all the time is the safest bet.
                        if (lvalue[0] == "assign" ||
                            lvalue[0] == "conditional" ||
                            (lvalue[0] == "binary" && PRECEDENCE[operator] >= PRECEDENCE[lvalue[1]])) {
                                left = "(" + left + ")";
                        }
                        if (rvalue[0] == "assign" ||
                            rvalue[0] == "conditional" ||
                            (rvalue[0] == "binary" && PRECEDENCE[operator] >= PRECEDENCE[rvalue[1]])) {
                                right = "(" + right + ")";
                        }
                        return add_spaces(left, operator, right);
                },
                "unary-prefix": function(operator, expr) {
                        var val = make(expr);
                        if (!(expr[0] in ATOMIC_START_TOKEN))
                                val = "(" + val + ")";
                        return operator + (is_alphanumeric_char(operator.charAt(0)) ? " " : "") + val;
                },
                "unary-postfix": function(operator, expr) {
                        var val = make(expr);
                        if (!(expr[0] in ATOMIC_START_TOKEN))
                                val = "(" + val + ")";
                        return val + operator;
                },
                "sub": function(expr, subscript) {
                        return make(expr) + "[" + make(subscript) + "]";
                },
                "object": make_object,
                "regexp": function(rx, mods) {
                        return "/" + rx.replace(/\x2f/g, "\\x2f") + "/" + mods;
                },
                "array": make_array,
                "stat": function(stmt) {
                        return make(stmt);
                },
                "seq": function() {
                        return add_commas(slice(arguments).map(make));
                },
                "label": function(name, block) {
                        return add_spaces(make_name(name), ":", make(block));
                }
        };

        function make_function(name, args, body) {
                var out = "function";
                if (name) {
                        out += " " + make_name(name);
                }
                out += "(" + add_commas(args.map(make_name)) + ")";
                return add_spaces(out, make_block(body));
        };

        function make_string(str) {
                return JSON.stringify(str); // XXX: that's cheating
        };

        function make_name(name) {
                return name.toString();
        };

        function make_block_statements(statements) {
                for (var a = [], last = statements.length - 1, i = 0; i <= last; ++i) {
                        var stat = statements[i];
                        var code = make(stat);
                        if (code == ";")
                                continue;
                        if ((beautify || i < last) && !/[;:]$/.test(code)) {
                                if (!(stat[0] in AVOID_SEMICOLON_AFTER && /\}$/.test(code))) {
                                        code += ";";
                                }
                        }
                        a.push(code);
                }
                return a;
        };

        function make_block(statements) {
                if (!statements) return ";";
                return "{" + newline + with_indent(function(){
                        return make_block_statements(statements)
                                .map(indent)
                                .join(newline);
                }) + newline + indent("}");
        };

        function make_1vardef(def) {
                var name = def[0], val = def[1];
                if (val != null)
                        name = add_spaces(name, "=", make(val));
                return name;
        };

        function make_vardefs(defs) {
                return add_commas(defs.map(make_1vardef));
        };

        function make_object(props) {
                if (props.length == 0)
                        return "{}";
                return "{" + newline + with_indent(function(){
                        return props.map(function(p){
                                return indent(add_spaces(make_string(p[0]), ":", make(p[1])));
                        }).join("," + newline);
                }) + newline + indent("}");
        };

        function make_array(elements) {
                if (elements.length == 0)
                        return "[]";
                return add_spaces("[", add_commas(elements.map(make)), "]");
        };

        function make(node) {
                var type = node[0];
                var gen = generators[type];
                if (!gen) {
                        throw new Error("Can't find generator for \"" + type + "\"");
                }
                return gen.apply(type, node.slice(1));
        };

        var out = make(ast);
        if (beautify) {
                var rx = repeat_string(" ", indent_level / 2) + "\x08";
                rx = new RegExp(rx, "g");
                out = out.replace(rx, "");
        } else {
                out = out.replace(/\x08/g, "");
        }
        return out;
};

/* -----[ compressor ]----- */

function process_ast(ast, options) {
        options = defaults(options, {
                mangle          : true,
                mangle_toplevel : true,
                resolve_consts  : true
        });

        var $scope = [];
        var $mangled = [];
        //$mangled[0]["-current"] = "@";

        var $current = "@";

        function $Unresolved(name) {
                this.name = name;
                this.scope = $scope[$scope.length - 1];
                this.scope["-unresolved"].push(this);
        };

        $Unresolved.prototype.toString = function() {
                return this.name;
        };
        $Unresolved.prototype.charAt = function(n) {
                return this.name.charAt(n);
        };

        function in_scope(name) {
                for (var i = $scope.length; --i >= 0;) {
                        if (name in $scope[i])
                                return $mangled[i][name];
                }
                return false;
        };
        function push_scope() {
                var scope = { "-unresolved": [] };
                $scope.push(scope);
                $mangled.push({});
                return scope;
        };
        function pop_scope() {
                $scope.pop();
                $mangled.pop();
        };
        function define(name) {
                var n = $scope.length - 1, s = $scope[n];
                if (name in s) {
                        // redefinition, should keep the previous name
                        return $mangled[n][name];
                }
                s[name] = true;
                if (options.mangle && (options.mangle_toplevel || n > 0)) {
                        return $mangled[n][name] = next_mangled(n);
                } else {
                        return $mangled[n][name] = name;
                }
        };
        function mangled(name, passTwo) {
                for (var i = $mangled.length; --i >= 0;) {
                        if (name in $mangled[i])
                                return $mangled[i][name];
                }
                return passTwo ? null : new $Unresolved(name);
        };
        function next_mangled(n) {
                var cm = $current, next;
                if (cm.charAt(0) == "$") next = "$" + (parseInt(cm.substr(1), 10) + 1);
                else if (cm < "Z") next = String.fromCharCode(cm.charCodeAt(0) + 1);
                else if (cm == "Z") next = "a";
                else if (cm < "z") next = String.fromCharCode(cm.charCodeAt(0) + 1);
                else next = "$1";
                $current = next;
                return next;
        };
        function is_constant(node) {
                return node[0] == "string" || node[0] == "num";
        };

        function with_new_scope(cont) {
                var s = push_scope();
                try {
                        return cont();
                } finally {
                        var still_unresolved = [];
                        s["-unresolved"].map(function(s){
                                var name = mangled(s.name, true);
                                if (name != null) s.name = name;
                                else still_unresolved.push(s);
                        });
                        pop_scope();
                        if ($scope.length > 0) {
                                var outer = $scope[$scope.length - 1]["-unresolved"];
                                outer.push.apply(outer, still_unresolved);
                        }
                }
        };

        var walkers = {
                "string": function(str) {
                        return [ "string", str ];
                },
                "num": function(num) {
                        return [ "num", num ];
                },
                "name": function(name) {
                        return [ "name", mangled(name) ];
                },
                "toplevel": function(statements) {
                        return [ "toplevel", statements.map(walk) ];
                },
                "block": function(statements) {
                        var out = [ "block" ];
                        if (statements != null)
                                out.push(statements.map(walk));
                        return out;
                },
                "var": function(defs) {
                        return [ "var", defs.map(function(def){
                                var a = [ define(def[0]) ];
                                if (def.length > 1)
                                        a[1] = walk(def[1]);
                                return a;
                        })];
                },
                "try": function(t, c, f) {
                        return [
                                "try",
                                walk(t),
                                c != null ? with_new_scope(function(){
                                        // it's being said that the
                                        // exception variable is local
                                        // to the catch block
                                        return [ define(c[0]), walk(c[1]) ];
                                }) : null,
                                f != null ? walk(f) : null
                        ];
                },
                "throw": function(expr) {
                        return [ "throw", walk(expr) ];
                },
                "new": function(ctor, args) {
                        return [ "new", walk(ctor), args.map(walk) ];
                },
                "switch": function(expr, body) {
                        return [ "switch", walk(expr), body.map(walk) ];
                },
                "case": function(expr) {
                        return [ "case", walk(expr) ];
                },
                "default": function() {
                        return [ "default" ];
                },
                "break": function(label) {
                        return [ "break", label ];
                },
                "continue": function(label) {
                        return [ "continue", label ];
                },
                "conditional": function(cond, t, e) {
                        return [ "conditional", walk(cond), walk(t), walk(e) ];
                },
                "assign": function(op, lvalue, rvalue) {
                        return [ "assign", op, walk(lvalue), walk(rvalue) ];
                },
                "dot": function(expr) {
                        return [ "dot", walk(expr) ].concat(slice(arguments, 1));
                },
                "call": function(expr, args) {
                        return [ "call", walk(expr), args.map(walk) ];
                },
                "function": function(name, args, body) {
                        var mname = name ? define(name) : null;
                        return with_new_scope(function(){
                                return [
                                        "function",
                                        mname,
                                        args.map(define),
                                        body.map(walk)
                                ];
                        });
                },
                "if": function(conditional, t, e) {
                        return [
                                "if",
                                walk(conditional),
                                walk(t),
                                walk(e)
                        ];
                },
                "for": function(init, cond, step, block) {
                        return [
                                "for",
                                walk(init),
                                walk(cond),
                                walk(step),
                                walk(block)
                        ];
                },
                "for-in": function(has_var, key, hash, block) {
                        if (has_var) {
                                key = define(key);
                        } else {
                                key = mangled(key);
                        }
                        return [
                                "for-in",
                                has_var,
                                key,
                                walk(hash),
                                walk(block)
                        ];
                },
                "while": function(cond, block) {
                        return [ "while", walk(cond), walk(block) ];
                },
                "do": function(cond, block) {
                        return [ "do", walk(cond), walk(block) ];
                },
                "return": function(expr) {
                        return [ "return", walk(expr) ];
                },
                "binary": function(op, left, right) {
                        left = walk(left);
                        right = walk(right);
                        if (options.resolve_consts && is_constant(left) && is_constant(right)) {
                                var val = null;
                                switch (op) {
                                    case "+": val = left[1] + right[1]; break;
                                    case "*": val = left[1] * right[1]; break;
                                    case "/": val = left[1] / right[1]; break;
                                    case "-": val = left[1] - right[1]; break;
                                }
                                if (val != null)
                                        return [ typeof val == "string" ? "string" : "num", val ];
                        }
                        return [ "binary", op, left, right ];
                },
                "unary-prefix": function(op, expr) {
                        return [ "unary-prefix", op, walk(expr) ];
                },
                "unary-postfix": function(op, expr) {
                        return [ "unary-postfix", op, walk(expr) ];
                },
                "sub": function(expr, subscript) {
                        return [ "sub", walk(expr), walk(subscript) ];
                },
                "object": function(props) {
                        return [ "object", props.map(function(p){
                                return [ p[0], walk(p[1]) ];
                        }) ];
                },
                "regexp": function(rx, mods) {
                        return [ "regexp", rx, mods ];
                },
                "array": function(elements) {
                        return [ "array", elements.map(walk) ];
                },
                "stat": function(stat) {
                        return [ "stat", walk(stat) ];
                },
                "seq": function() {
                        return [ "seq" ].concat(slice(arguments).map(walk));
                },
                "label": function(name, block) {
                        return [ "label", name, walk(block) ];
                }
        };

        walkers["defun"] = walkers["function"];

        function walk(node) {
                if (node == null)
                        return null;
                var type = node[0];
                var gen = walkers[type];
                return gen.apply(type, node.slice(1));
        };

        return with_new_scope(function() {
                return walk(ast);
        });

};

/* -----[ Utilities ]----- */

function repeat_string(str, i) {
        if (i <= 0) return "";
        if (i == 1) return str;
        var d = repeat_string(str, i >> 1);
        d += d;
        if (i & 1) d += str;
        return d;
};

function curry(f) {
        var args = slice(arguments, 1);
        return function() { return f.apply(this, args.concat(slice(arguments))); };
};

function prog1(ret) {
        if (ret instanceof Function)
                ret = ret();
        for (var i = 1, n = arguments.length; --n > 0; ++i)
                arguments[i]();
        return ret;
};

function deep_copy(obj) {
        if (obj instanceof Array)
                return obj.map(deep_copy);
        if (obj instanceof Date)
                return new Date(obj.getTime());
        if (typeof obj == "object") {
                var ret = {};
                for (var i in obj) if (obj.hasOwnProperty(i))
                        ret[i] = deep_copy(obj[i]);
                return ret;
        }
        return obj;
};

function array_to_hash(a) {
        var ret = {};
        for (var i = 0; i < a.length; ++i)
                ret[a[i]] = true;
        return ret;
};

function slice(a, start) {
        return Array.prototype.slice.call(a, start == null ? 0 : start);
};

function remove(a, pred) {
        var b = [], el, i;
        for (i = 0; i < a.length; ++i) {
                el = a[i];
                if (!pred(el))
                        b.push(el);
        }
        return b;
};

function characters(str) {
        return str.split("");
};

function member(name, array) {
        for (var i = array.length; --i >= 0;)
                if (array[i] == name)
                        return true;
        return false;
};

function defaults(args, defs) {
        var ret = {};
        for (var i in defs)
                ret[i] = (args && i in args) ? args[i] : defs[i];
        return ret;
};

exports.tokenizer = tokenizer;
exports.parse = parse;
exports.gen_code = gen_code;
exports.process_ast = process_ast;
