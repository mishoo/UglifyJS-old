#! /usr/bin/env node

var sys = require("sys");
var fs = require("fs");
global.sys = sys;

var jsp = require("../lib/parse-js");

var code = "(function parc(moo, man){\n\
  try {\n\
    var foobar = 10;\n\
    return parc(foobar + moo + man);\n\
  } catch(ex) {\n\
    log(ex);\n\
    return foobar;\n\
  }\n\
})();\n\
";

fs.readFile(
        "../lib/parse-js.js"
        //"/tmp/foo1.js"
        , "utf8", function(err, data){
                code = [ data ].join("\n\n");
                try {
                        var ast = jsp.parse(code);
                        // sys.puts(JSON.stringify(ast) + "\n");

                        var ast2 = jsp.process_ast(ast);

                        // sys.puts(JSON.stringify(ast2));
                        // sys.puts("\n");

                        var out = jsp.gen_code(ast2, true);
                        sys.puts(out);

                } catch(ex) {
                        sys.log(ex.stack);
                }
        }
);
