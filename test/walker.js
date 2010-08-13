#! /usr/bin/env node

global.sys = require("sys");
var fs = require("fs");

var jsp = require("../lib/parse-js");
var pro = require("../lib/process");

global.log_inspect = function(obj) {
        sys.puts(sys.inspect(obj, false, null));
};

var code = "//var eval;\n\
var a = function(z){\n\
var e = eval;\n\
try {\n\
var boo = 10;\n\
return boo; }\n\
catch(ex) {show(ex + boo)}\n\
finally e(crap);\n\
}\n\
function bar(moo, man){\n\
var parc = 20, qwe = moo / man, zap = 10 * 23 + '50';\n\
var maka = 20/5;\n\
the_fun.name = 'the_fun';\n\
while (foo) {\n\
  var aqwe = 10;\n\
  var bqwe = 20;\n\
  var cqwe = 30;\n\
};\n\
switch(foo){\n\
  case 'bar':\n\
    var aqwe = 10;\n\
    var bqwe = 20;\n\
  case 'baz':\n\
    var foo = 10;\n\
    var bar = 20;\n\
};\n\
(function(qwe, rty, uio){\n\
  var moo = 10, man = 20, foo = 3+4+5*6;\n\
  return (qwe['park']['mak']['false'] / rty) * uio + (moo + man + foo);\n\
})();\n\
function the_fun() {};\n\
var newvar = 10;\n\
return (newvar * zap) + moo + (man + qwe) * parc;\n\
}\n\
";

var ast = jsp.parse(code);
var ast3 = pro.ast_mangle(ast);
var ast4 = pro.ast_squeeze(ast3);
log_inspect(ast4);
sys.puts(pro.gen_code(ast4, true));
