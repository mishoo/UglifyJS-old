#! /usr/bin/env node

global.sys = require("sys");
var fs = require("fs");

var jsp = require("../lib/parse-js");

var filename = process.argv[2];
fs.readFile(filename, "utf8", function(err, text){
        try {
                var ast = time_it("parse", function(){ return jsp.parse(text); });
                //sys.puts(JSON.stringify(ast));
                var ast2 = time_it("process", function(){ return jsp.process_ast(ast, { mangle: false }) });
                var gen = time_it("generate", function(){ return jsp.gen_code(ast2, false) });
                sys.puts(gen);
        } catch(ex) {
                sys.debug(ex.stack);
                sys.debug(sys.inspect(ex));
        }
});

function time_it(name, cont) {
        var t1 = new Date().getTime();
        var ret = cont();
        var diff = new Date().getTime() - t1;
        sys.debug("// " + name + ": " + (diff / 1000).toFixed(3) + " sec.");
        return ret;
};
