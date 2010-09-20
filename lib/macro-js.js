var ParseJS = require("./parse-js").ParseJS;
var pro = require("./process");
var $C = require("./constants");
var HOP = $C.HOP;

function Unquote(ast) { this.ast = ast; };

function Symbol(sym) { this.sym = sym; };

Symbol.prototype.toString = function() { return this.sym; };

function quote_ast(ast) {
        if (ast === null) {
                return [ "name", "null" ];
        }
        else if (typeof ast == "undefined") {
                return [ "name", "undefined" ];
        }
        else if (ast instanceof Unquote) {
                return ast.ast;
        }
        else if (ast instanceof Symbol) {
                return ast;
        }
        else if (ast instanceof Array) {
                return [ "array", ast.map(quote_ast) ];
        }
        else if (typeof ast == "string") {
                return [ "string", ast ];
        }
        else if (typeof ast == "boolean") {
                return [ "name", ast.toString() ];
        }
        else if (typeof ast == "number") {
                return isNaN(ast)
                        ? [ "name", "NaN" ]
                        : [ "num", ast ];
        }
        else throw new Error("Unhandled case in quote: " + typeof ast + "\n" + sys.inspect(ast, null, null));
};

function createParser() {
        var parser = new ParseJS();
        var SYM = 0;
        parser.gensym = function() {
                return new Symbol("__$$__SYM" + (++SYM));
        };
        parser.symbol = function(name) {
                return new Symbol(name);
        };
        parser.macro_expand = function(ast) {
                return macro_expand(parser, ast);
        };
        parser.quote = quote_ast;
        parser.macros = {};
        parser.define_token_reader("`", function(TC, OC) {
                TC.next();
                var tok = TC.next_token();
                tok.macro = "quote";
                return tok;
        });
        parser.define_token_reader("@", function(TC, OC) {
                TC.next();
                var tok = TC.next_token();
                tok.macro = "quote-stmt";
                return tok;
        });
        parser.define_token_reader("\\", function(TC, OC) {
                TC.next();
                var tok = TC.next_token();
                tok.macro = "unquote";
                return tok;
        });
        parser.define_statement("defmacro", function(PC, OC) {
                var m = read_defmacro(PC, OC);
                return compile_macro(m.name, m.args, m.body, parser);
        });
        parser.define_statement("defstat", function(PC, OC) {
                // what happens here is really quite tricky: if
                // immediately after "defstat" you use the new
                // statement, it won't be seen as a keyword because
                // the token has already been peek()-ed.  Hence, we
                // use a hack -- passing true to readDefMacro will
                // register the new name as a keyword immediately.
                var m = read_defmacro(PC, OC, true);
                parser.define_statement(m.name, function(PC, OC) {
                        var a = [];
                        for (var i = 0; i < m.args.length; ++i)
                                a[i] = m.args[i].reader();
                        return [ "macro-expand", m.name, a ];
                });
                return compile_macro(m.name, m.args, m.body, parser, true);
        });
        parser.define_token_processor(function(cont, PC, OC){
                var tok = PC.token();
                if (!tok.macro)
                        return cont();
                switch (tok.macro) {
                    case "quote":
                        return quote_ast(cont());
                    case "quote-stmt":
                        return quote_ast(PC.statement());
                    case "unquote":
                        return new Unquote(cont());
                    default:
                        throw new Error("Unsupported macro character: " + tok.macro);
                }
        });
        var orig_parse = parser.parse;
        parser.parse = function() {
                return macro_expand(parser, orig_parse.apply(this, arguments));
        };
        return parser;
};

function read_macro_args(PC, OC) {
        var args = [];
        PC.expect("(");
        var first = true;
        while (!PC.is("punc", ")")) {
                if (first) first = false; else PC.expect(",");
                if (!PC.is("name")) PC.unexpected();
                var a = { name: PC.tokval() };
                PC.next();
                if (PC.is("punc", ":")) {
                        PC.next();
                        if (!(PC.is("name") || PC.is("keyword")))
                                PC.unexpected();
                        switch (a.type = PC.tokval()) {
                            case "block":
                                a.reader = function() {
                                        return [ "block", [ PC.tokprocess(PC.statement) ] ];
                                };
                                break;
                            case "name":
                                a.reader = function() {
                                        if (!PC.is("name")) PC.unexpected();
                                        return new Symbol(OC.prog1(function() {
                                                return PC.tokprocess(PC.tokval);
                                        }, PC.next));
                                };
                                break;
                            default:
                                PC.unexpected();
                        }
                        PC.next();
                } else {
                        a.reader = OC.curry(PC.expression, false);
                }
                args.push(a);
        }
        PC.next();         // skip closing paren
        return args;
};

function read_defmacro(PC, OC, make_kw) {
        //*** read macro name
        if (!PC.is("name")) PC.unexpected();
        var name = PC.tokval();
        // this is needed for defstat.
        if (make_kw)
                OC.self.define_keyword(name);
        PC.next();
        //*** read arguments list
        var args = read_macro_args(PC, OC);
        //*** read body; set in_function so that "return" is allowed.
        PC.S.in_function++;
        var body = PC.block_();
        PC.S.in_function--;
        return { name: name, args: args, body: body };
};

function compile_macro(name, args, body, parser, statement_only) {
        if (HOP(parser.macros, name)) {
                throw new Error("Redefinition of macro '" + name + "'");
        }
        var ast = [ "toplevel", [[
                "defun",
                name,
                args.map(function(a) { return a.name }),
                body
        ]]];
        var code = pro.gen_code(ast, { indent_start: 3, plainsyms: true });
        var func;
        try { func = new Function("return (" + code + ");").call(parser); } catch(ex) {
                sys.puts("Error compiling macro '" + name + "'");
                sys.puts(code);
                sys.puts(ex.toString());
                throw ex;
        }
        parser.macros[name] = {
                args: args,
                func: func
        };
        if (!statement_only) {
                parser.define_call_parser(name, function(PC, OC){
                        PC.expect("(");
                        var first = true, a = [];
                        while (!PC.is("punc", ")")) {
                                if (first) first = false; else PC.expect(",");
                                a.push(args[a.length].reader());
                        }
                        PC.next();
                        return [ "macro-expand", name, a ];
                });
        }
        return [ "comment2", "*** // Macro '" + name + "' compiled as:\n" + code + "\n ***" ];
};

function macro_expand(parser, ast) {
        var w = pro.ast_walker();
        return normalize_ast(w.with_walkers({
                "macro-expand": function(macro, args) {
                        var func = parser.macros[macro].func;
                        var ret = func.apply(parser, args.map(w.walk));
                        ret = replace_symbols(ret);
                        ret = w.walk(ret);
                        return ret;
                }
        }, function() {
                return w.walk(ast);
        }));
};

function normalize_symbol(s, wantname) {
        if (s instanceof Symbol) {
                return wantname
                        ? [ "name", s.toString() ]
                        : s.toString();
        }
        else if (s instanceof Array && s[0] == "name" && !wantname) {
                return s[1];
        }
        return s;
};

function replace_symbols(ast) {
        if (ast instanceof Array) {
                switch (ast[0]) {
                    case "var":
                    case "const":
                    case "object":
                        ast[1].forEach(function(def){
                                def[0] = normalize_symbol(def[0]);
                                if (def[1])
                                        def[1] = replace_symbols(def[1]);
                        });
                        return ast;
                    case "function":
                    case "defun":
                        ast[1] = normalize_symbol(ast[1]);
                        ast[2] = ast[2].map(function(name){ return normalize_symbol(name) });
                        ast[3] = ast[3].map(replace_symbols);
                        return ast;
                    case "try":
                        // 0 block, 1 catch: 1.0 ex, 1.1 block, 2 finally
                        ast[0] = replace_symbols(ast[0]);
                        if (ast[1]) {
                                ast[1][0] = normalize_symbol(ast[1][0]);
                                ast[1][1] = ast[1][1].map(replace_symbols);
                        }
                        if (ast[2]) {
                                ast[2] = ast[2].map(replace_symbols);
                        }
                        return ast;
                    default:
                        for (var i = 0; i < ast.length; ++i)
                                ast[i] = replace_symbols(ast[i]);
                        return ast;
                }
        } else {
                return normalize_symbol(ast, true);
        }
        return ast;
};

function normalize_ast(ast) {
        ast = replace_symbols(ast);
        var w = pro.ast_walker();
        return w.with_walkers({
                "stat": function(expr) {
                        expr = w.walk(expr);
                        switch (expr[0]) {
                            case "block":
                                if (expr[1] && expr[1].length == 1)
                                        return expr[1][0];
                                return expr;
                            case "break":
                            case "const":
                            case "continue":
                            case "defun":
                            case "do":
                            case "for":
                            case "for-in":
                            case "if":
                            case "return":
                            case "switch":
                            case "throw":
                            case "try":
                            case "var":
                            case "while":
                            case "with":
                                return expr;
                        }
                }
        }, function() {
                return w.walk(ast);
        });
};

/* -----[ Exports ]----- */

exports.createParser = createParser;
