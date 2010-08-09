#! /usr/bin/env node

global.sys = require("sys");
var jsp = require("../lib/parse-js");

var code = "Array.prototype.peek = function (x) {\n\
if (this.length > 0)\n\
return this[this.length - 1 - (x != null ? Math.abs(x) : 0)];\n\
}";

code = "function peek(a){if(this.length>0){return this[this.length - 1- (a!=null?Math.abs(a):0)]}}";

code = "a == b ? (c = d) : (e = f);";

code = "function foo(){return}";

code = "a = { x: p.x != null ? p.x + 2 : null, y: p.y };";

code = "with(a = {}) { foo; bar; }";

code = "a + ++b";

code = "a++ + b";

code = '(a + b)("foo")';

code = ".1";

try {
        var ast = jsp.parse(code);
        sys.puts(JSON.stringify(ast));
        sys.puts(jsp.gen_code(ast, true));
} catch(ex) {
        sys.puts(sys.inspect(ex));
}
