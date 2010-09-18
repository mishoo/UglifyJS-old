var ParseJS = require("./parse-js").ParseJS;
var pro = require("./process");
var $C = require("./constants");
var HOP = $C.HOP;

function createParser() {
        var parser = new ParseJS();
        parser.macros = {};
        parser.define_statement("defmacro", function(PC, OC) {
                var m = readDefMacro(PC, OC);
                return compileMacro(m.name, m.args, m.body, parser);
        });
        return parser;
};

function readDefMacro(PC, OC) {
        var name, args = [], body;
        //*** read macro name
        if (!PC.is("name")) PC.unexpected();
        name = PC.tokval();
        PC.next();
        //*** read arguments list
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
        //*** read body; set in_function so that "return" is allowed.
        PC.S.in_function++;
        body = PC.block_();
        PC.S.in_function--;
        return { name: name, args: args, body: body };
};

function compileMacro(name, args, body, parser) {
        if (HOP(parser.macros, name)) {
                throw new Error("Redefinition of macro '" + name + "'");
        }
        var code = pro.gen_code([ "toplevel", [[
                "defun",
                name,
                args.map(function(a) { return a.name }),
                body
        ]]], { indent_start: 3 });
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
