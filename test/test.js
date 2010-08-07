#! /usr/bin/env node

var sys = require("sys");
var fs = require("fs");
global.sys = sys;

var jsp = require("../lib/parse-js");

var code = "var a; var b, c; var d = 10; ++d; b--; for (var i = 0; i < 10; ++i) { boo(i) } if (foo == 10) { a.bar.baz = 5; ++c; } (function(){ (function(){ try {foo} catch (ex) { alert(parc) } })(); })();";

code += "\n\nfunction foo(a, b){ while(a) { b(a)['foo'] *= 10; } return b; }";

code += "\n\na = { foo: 1, bar: 2, baz: '3' }";

code += "\n\nmoo = function() { alert('moo man') }";

code += "\n\nvar moo = function() { return [1, 2, '3', { foo: 'bar' }] }";

code += "\n\nfor (var i in foo) { out(foo[i]) }";

code += "\n\ndo { out(foo[i]) } while(parc)";

code += "\n\n(a + b).toString();";

code += "\n\n(a + b).foo.bar['baz'].caz.toString();";

code += "\n\n(5).toString();";

code += "\n\n'foo'.toString();";

code += "\n\nfoo.toString();";

code += "\n\nfoo = 'bar';";

code += "\n\nif (foo) bar(); else parc();";

code += "\n\n(++b).toString()";

code += "\n\nfalse.toString()";

code += "\n\nif(true);";

code += "\n\nvar a = 5, b = null, i;";

code += "\n\nvar a = [], b, i;";

code += "\n\nif (foo) { bar() } else if (bar) { foo() } else { parc() }";

code += "\n\nif (foo) bar(); else if (bar) foo(); else parc();";

fs.readFile(
        "../lib/parse-js.js"
        // "/tmp/foo1.js"
            , "utf8", function(err, data){
                    //code = [ data ].join("\n\n");
                    doit(code);
});

function doit(code) {
        var p = jsp.parse(code);
        sys.puts(JSON.stringify(p));

        sys.puts("\n");

        var gen = jsp.gen_code(p, {
                indent_start: 0,
                tab_width: 4
        });
        sys.puts(gen);

        //eval(gen);
};
