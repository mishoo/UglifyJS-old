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
        else throw new Error("Unhandled case in quote: " + typeof ast);
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
                var m = readDefMacro(PC, OC);
                return compileMacro(m.name, m.args, m.body, parser);
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
        // finally, the AST that we build is a bit different from what
        // our processors already know, so we include a final step to
        // normalize it.
        var orig_parse = parser.parse;
        parser.parse = function() {
                return normalize_ast(orig_parse.apply(this, arguments));
        };
        return parser;
};

function readMacroArgs(PC, OC) {
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
                                a.reader = PC.block_;
                                break;
                            case "name":
                                a.reader = function() {
                                        if (!PC.is("name")) PC.unexpected();
                                        return new Symbol(OC.prog1(PC.tokval, PC.next));
                                };
                                break;
                            case "string":
                                a.reader = function() {
                                        if (!PC.is("string")) PC.unexpected();
                                        return OC.prog1(PC.tokval, PC.next);
                                };
                            case "num":
                                a.reader = function() {
                                        if (!PC.is("num")) PC.unexpected();
                                        return OC.prog1(PC.tokval, PC.next);
                                };
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

function readDefMacro(PC, OC) {
        //*** read macro name
        if (!PC.is("name")) PC.unexpected();
        var name = PC.tokval();
        PC.next();
        //*** read arguments list
        var args = readMacroArgs(PC, OC);
        //*** read body; set in_function so that "return" is allowed.
        PC.S.in_function++;
        var body = PC.block_();
        PC.S.in_function--;
        return { name: name, args: args, body: body };
};

function compileMacro(name, args, body, parser) {
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
        parser.define_call_parser(name, function(PC, OC){
                PC.expect("(");
                var first = true, a = [];
                while (!PC.is("punc", ")")) {
                        if (first) first = false; else PC.expect(",");
                        a.push(args[a.length].reader());
                }
                PC.next();
                return func.apply(parser, a);
        });
        return [ "comment2", "*** // Macro '" + name + "' compiled as:\n" + code + "\n ***" ];
};

function replace_symbols(ast) {
        if (ast instanceof Array) {
                switch (ast[0]) {
                    case "var":
                    case "const":
                    case "object":
                        ast[1].forEach(function(def){
                                if (def[0] instanceof Symbol)
                                        def[0] = def[0].toString();
                                if (def[1])
                                        def[1] = replace_symbols(def[1]);
                        });
                        return ast;
                    case "function":
                    case "defun":
                        if (ast[1] instanceof Symbol)
                                ast[1] = ast[1].toString();
                        ast[2] = ast[2].map(function(name, i){
                                return name instanceof Symbol ? name.toString() : name;
                        });
                        ast[3] = ast[3].map(replace_symbols);
                        return ast;
                    case "try":
                        // 0 block, 1 catch: 1.0 ex, 1.1 block, 2 finally
                        ast[0] = replace_symbols(ast[0]);
                        if (ast[1]) {
                                if (ast[1][0] instanceof Symbol)
                                        ast[1][0] = ast[1][0].toString();
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
        } else if (ast instanceof Symbol) {
                return [ "name", ast.toString() ];
        }
        return ast;
};

function normalize_ast(ast) {
        ast = replace_symbols(ast);
        INSPECT(ast);
        var w = pro.ast_walker();
        return w.with_walkers({
                "stat": function(expr) {
                        if (expr[0] == "block") {
                                if (expr[1] && expr[1].length == 1)
                                        return expr[1][0];
                                return expr;
                        }
                }
        }, function() {
                return w.walk(ast);
        });
};

/* -----[ Exports ]----- */

exports.createParser = createParser;
