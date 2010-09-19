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
                                        return OC.prog1(PC.tokval, PC.next);
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

/* -----[ Exports ]----- */

exports.createParser = createParser;
