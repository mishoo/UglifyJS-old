#! /usr/bin/env node

global.sys = require("sys");
global.INSPECT = INSPECT;
var fs = require("fs");

var macrojs = require("../lib/macro-js");
var pro = require("../lib/process");
var p = macrojs.createParser();

fs.readFile(process.argv[2], function(err, data){
        data = data.toString();
        var ast = p.parse(data);
        INSPECT(ast);
        // sys.puts(pro.gen_code(pro.ast_squeeze(ast), true));
        sys.puts(pro.gen_code(ast, true));
});

function INSPECT(obj) {
        sys.puts(sys.inspect(obj, null, null));
};
