/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.

  This version is suitable for Node.js.  With minimal changes (the
  exports stuff) it should work on any JS platform.

  This file implements some AST processors.  They work on data built
  by parse-js.

  Exported functions:

    - ast_mangle(ast, include_toplevel) -- mangles the
      variable/function names in the AST.  Returns an AST.  Pass true
      as second argument to mangle toplevel names too.

    - ast_squeeze(ast) -- employs various optimizations to make the
      final generated code even smaller.  Returns an AST.

    - gen_code(ast, beautify) -- generates JS code from the AST.  Pass
      true (or an object, see the code for some options) as second
      argument to get "pretty" (indented) code.

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under a ZLIB license:

    Copyright 2010 (c) Mihai Bazon <mihai.bazon@gmail.com>

    This software is provided 'as-is', without any express or implied
    warranty. In no event will the authors be held liable for any
    damages arising from the use of this software.

    Permission is granted to anyone to use this software for any
    purpose, including commercial applications, and to alter it and
    redistribute it freely, subject to the following restrictions:

    1. The origin of this software must not be misrepresented; you must
       not claim that you wrote the original software. If you use this
       software in a product, an acknowledgment in the product
       documentation would be appreciated but is not required.

    2. Altered source versions must be plainly marked as such, and must
       not be misrepresented as being the original software.

    3. This notice may not be removed or altered from any source
       distribution.

 ***********************************************************************/

var jsp = require("./parse-js"),
    slice = jsp.slice,
    PRECEDENCE = jsp.PRECEDENCE;

/* -----[ helper for AST traversal ]----- */

function ast_walker(ast) {
        var walkers = {
                "string": function(str) {
                        return [ "string", str ];
                },
                "num": function(num) {
                        return [ "num", num ];
                },
                "name": function(name) {
                        return [ "name", name ];
                },
                "toplevel": function(statements) {
                        return [ "toplevel", statements.map(walk) ];
                },
                "block": function(statements) {
                        var out = [ "block" ];
                        if (statements != null)
                                out.push(statements.map(walk));
                        return out;
                },
                "var": function(defs) {
                        return [ "var", defs.map(function(def){
                                var a = [ def[0] ];
                                if (def.length > 1)
                                        a[1] = walk(def[1]);
                                return a;
                        })];
                },
                "try": function(t, c, f) {
                        return [
                                "try",
                                walk(t),
                                c != null ? [ c[0], walk(c[1]) ] : null,
                                f != null ? walk(f) : null
                        ];
                },
                "throw": function(expr) {
                        return [ "throw", walk(expr) ];
                },
                "new": function(ctor, args) {
                        return [ "new", walk(ctor), args.map(walk) ];
                },
                "switch": function(expr, body) {
                        return [ "switch", walk(expr), body.map(walk) ];
                },
                "case": function(expr) {
                        return [ "case", walk(expr) ];
                },
                "default": function() {
                        return [ "default" ];
                },
                "break": function(label) {
                        return [ "break", label ];
                },
                "continue": function(label) {
                        return [ "continue", label ];
                },
                "conditional": function(cond, t, e) {
                        return [ "conditional", walk(cond), walk(t), walk(e) ];
                },
                "assign": function(op, lvalue, rvalue) {
                        return [ "assign", op, walk(lvalue), walk(rvalue) ];
                },
                "dot": function(expr) {
                        return [ "dot", walk(expr) ].concat(slice(arguments, 1));
                },
                "call": function(expr, args) {
                        return [ "call", walk(expr), args.map(walk) ];
                },
                "function": function(name, args, body) {
                        return [ "function", name, args.slice(), body.map(walk) ];
                },
                "defun": function(name, args, body) {
                        return [ "defun", name, args.slice(), body.map(walk) ];
                },
                "if": function(conditional, t, e) {
                        return [ "if", walk(conditional), walk(t), walk(e) ];
                },
                "for": function(init, cond, step, block) {
                        return [ "for", walk(init), walk(cond), walk(step), walk(block) ];
                },
                "for-in": function(has_var, key, hash, block) {
                        return [ "for-in", has_var, key, walk(hash), walk(block) ];
                },
                "while": function(cond, block) {
                        return [ "while", walk(cond), walk(block) ];
                },
                "do": function(cond, block) {
                        return [ "do", walk(cond), walk(block) ];
                },
                "return": function(expr) {
                        return [ "return", walk(expr) ];
                },
                "binary": function(op, left, right) {
                        return [ "binary", op, walk(left), walk(right) ];
                },
                "unary-prefix": function(op, expr) {
                        return [ "unary-prefix", op, walk(expr) ];
                },
                "unary-postfix": function(op, expr) {
                        return [ "unary-postfix", op, walk(expr) ];
                },
                "sub": function(expr, subscript) {
                        return [ "sub", walk(expr), walk(subscript) ];
                },
                "object": function(props) {
                        return [ "object", props.map(function(p){
                                return [ p[0], walk(p[1]) ];
                        }) ];
                },
                "regexp": function(rx, mods) {
                        return [ "regexp", rx, mods ];
                },
                "array": function(elements) {
                        return [ "array", elements.map(walk) ];
                },
                "stat": function(stat) {
                        return [ "stat", walk(stat) ];
                },
                "seq": function() {
                        return [ "seq" ].concat(slice(arguments).map(walk));
                },
                "label": function(name, block) {
                        return [ "label", name, walk(block) ];
                },
                "with": function(expr, block) {
                        return [ "with", walk(expr), walk(block) ];
                },
                "atom": function(name) {
                        return [ "atom", name ];
                }
        };

        var user = {};

        function walk(ast) {
                if (ast == null)
                        return null;
                var type = ast[0];
                var gen = user[type];
                if (gen) {
                        var ret = gen.apply(ast, ast.slice(1));
                        if (ret != null)
                                return ret;
                }
                gen = walkers[type];
                return gen.apply(ast, ast.slice(1));
        };

        function with_walkers(walkers, cont){
                var save = {}, i;
                for (i in walkers) if (HOP(walkers, i)) {
                        save[i] = user[i];
                        user[i] = walkers[i];
                }
                try { return cont(); }
                finally {
                        for (i in save) if (HOP(save, i)) {
                                if (!save[i]) delete user[i];
                                else user[i] = save[i];
                        }
                }
        };

        return {
                walk: walk,
                with_walkers: with_walkers
        };
};

/* -----[ Scope and mangling ]----- */

function Scope(parent) {
        this.names = {};        // names defined in this scope
        this.mangled = {};      // mangled names (orig.name => mangled)
        this.rev_mangled = {};  // reverse lookup (mangled => orig.name)
        this.cname = -1;        // current mangled name
        this.refs = {};         // names referenced from this scope
        this.uses_with = false; // will become TRUE if eval() is detected in this or any subscopes
        this.uses_eval = false; // will become TRUE if with() is detected in this or any subscopes
        this.parent = parent;   // parent scope
        this.children = [];     // sub-scopes
        if (parent) {
                this.level = parent.level + 1; // for debugging
                parent.children.push(this);
        } else {
                this.level = 0; // for debugging
        }
};

var base54 = (function(){
        var DIGITS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_";
        return function(num) {
                var ret = "";
                do {
                        ret = DIGITS.charAt(num % 54) + ret;
                        num = Math.floor(num / 54);
                } while (num > 0);
                return ret;
        };
})();

Scope.prototype = {
        has: function(name) {
                for (var s = this; s; s = s.parent)
                        if (HOP(s.names, name))
                                return s;
        },
        has_mangled: function(mname) {
                for (var s = this; s; s = s.parent)
                        if (HOP(s.rev_mangled, mname))
                                return s;
        },
        toJSON: function() {
                return {
                        names: this.names,
                        uses_eval: this.uses_eval,
                        uses_with: this.uses_with
                };
        },
        get_mangled: function(name, newMangle) {
                if (this.uses_eval || this.uses_with) return name; // no mangle if eval or with is in use
                var s = this.has(name);
                if (!s) return name; // not in visible scope, no mangle
                if (HOP(s.mangled, name)) return s.mangled[name]; // already mangled in this scope
                if (!newMangle) return name;                      // not found and no mangling requested

                // now we have to be smart.
                // we must be careful that the new mangled name:
                //
                // 1. doesn't shadow a mangled name from a parent
                //    scope, unless we don't reference the original
                //    name from this scope OR from any sub-scopes!
                //    This will get slow.
                //
                // 2. doesn't shadow an original name from a parent
                //    scope, in the event that the parent scope
                //    doesn't support mangling (uses_eval or
                //    uses_with) and we reference that name here OR IN
                //    ANY SUBSCOPES!  Damn!
                //
                // 3. doesn't shadow a name that is referenced but not
                //    defined (possibly global defined elsewhere).

                var m = (function(){
                        for (;;) {
                                var m = base54(++s.cname), prior;

                                // case 1.
                                prior = s.has_mangled(m);
                                if (prior && s.refs[prior.rev_mangled[m]] === prior)
                                        continue;

                                // case 2.
                                prior = s.has(m);
                                if (prior && (prior.uses_eval || prior.uses_with) && s.refs[m] === prior)
                                        continue;

                                // case 3.
                                if (HOP(s.refs, m) && s.refs[m] == null)
                                        continue;

                                return m;
                        }
                })();

                s.rev_mangled[m] = name;
                return s.mangled[name] = m;
        }
};

function ast_add_scope(ast) {

        var current_scope = null;
        var w = ast_walker(), walk = w.walk;
        var having_eval = [];

        function with_new_scope(cont) {
                current_scope = new Scope(current_scope);
                try {
                        var ret = cont();
                        ret.scope = current_scope;
                        return ret;
                }
                finally {
                        current_scope = current_scope.parent;
                }
        };

        function define(name) {
                if (name != null)
                        current_scope.names[name] = true;
                return name;
        };

        function reference(name) {
                current_scope.refs[name] = true;
        };

        function _lambda(name, args, body) {
                return [ this[0], define(name), args, with_new_scope(function(){
                        args.map(define);
                        return body.map(walk);
                })];
        };

        return with_new_scope(function(){
                // process AST
                var ret = w.with_walkers({
                        "function": _lambda,
                        "defun": _lambda,
                        "with": function(expr, block) {
                                for (var s = current_scope; s; s = s.parent)
                                        s.uses_with = true;
                        },
                        "var": function(defs) {
                                defs.map(function(d){ define(d[0]) });
                        },
                        "try": function(t, c, f) {
                                if (c != null) return [
                                        "try",
                                        walk(t),
                                        with_new_scope(function(){
                                                return [ define(c[0]), walk(c[1]) ];
                                        }),
                                        walk(f)
                                ];
                        },
                        "name": function(name) {
                                if (name == "eval")
                                        having_eval.push(current_scope);
                                reference(name);
                        },
                        "for-in": function(has_var, name) {
                                if (has_var) define(name);
                        }
                }, function(){
                        return walk(ast);
                });

                // the reason why we need an additional pass here is
                // that names can be used prior to their definition.

                // scopes where eval was detected and their parents
                // are marked with uses_eval, unless they define the
                // "eval" name.
                having_eval.map(function(scope){
                        if (!scope.has("eval")) while (scope) {
                                scope.uses_eval = true;
                                scope = scope.parent;
                        }
                });

                // for referenced names it might be useful to know
                // their origin scope.  current_scope here is the
                // toplevel one.
                function fixrefs(scope, i) {
                        // do children first; order shouldn't matter
                        for (i = scope.children.length; --i >= 0;)
                                fixrefs(scope.children[i]);
                        for (i in scope.refs) if (HOP(scope.refs, i)) {
                                // find origin scope and propagate the reference to origin
                                for (var origin = scope.has(i), s = scope; s && s !== origin; s = s.parent)
                                        s.refs[i] = origin;
                        }
                };
                fixrefs(current_scope);

                return ret;
        });

};

/* -----[ mangle names ]----- */

function ast_mangle(ast, do_toplevel) {
        var w = ast_walker(), walk = w.walk, scope;

        function get_mangled(name, newMangle) {
                if (!do_toplevel && !scope.parent) return name; // don't mangle toplevel
                return scope.get_mangled(name, newMangle);
        };

        function _lambda(name, args, body) {
                name = get_mangled(name);
                body = with_scope(body.scope, function(){
                        args = args.map(function(name){ return get_mangled(name) });
                        return body.map(walk);
                });
                return [ this[0], name, args, body ];
        };

        function with_scope(s, cont) {
                var _scope = scope;
                scope = s;
                for (var i in s.names) if (HOP(s.names, i)) {
                        get_mangled(i, true);
                }
                try { return cont(); }
                finally { scope = _scope; };
        };

        return w.with_walkers({
                "function": _lambda,
                "defun": _lambda,
                "var": function(defs) {
                        return [ "var", defs.map(function(d){
                                return [ get_mangled(d[0]), walk(d[1]) ];
                        })];
                },
                "name": function(name) {
                        return [ "name", get_mangled(name) ];
                },
                "try": function(t, c, f) {
                        return [ "try",
                                 walk(t),
                                 c ? with_scope(c.scope, function(){
                                         return [ get_mangled(c[0]), walk(c[1]) ];
                                 }) : null,
                                 walk(f) ];
                },
                "toplevel": function(body) {
                        return with_scope(this.scope, function(){
                                return [ "toplevel", body.map(walk) ];
                        });
                },
                "for-in": function(has_var, name, obj, stat) {
                        return [ "for-in", has_var, get_mangled(name), walk(obj), walk(stat) ];
                }
        }, function() {
                return walk(ast_add_scope(ast));
        });
};

/* -----[
   - compress foo["bar"] into foo.bar,
   - remove block brackets {} where possible
   - join consecutive var declarations
   - various optimizations for IFs:
     - if (cond) foo(); else bar();  ==>  cond?foo():bar();
     - if (cond) foo();  ==>  cond&&foo();
     - if (foo) return bar(); else return baz();  ==> return foo?bar():baz(); // also for throw
     - if (foo) return bar(); else something();  ==> {if(foo)return bar();something()}
   ]----- */

function ast_squeeze(ast) {

        var w = ast_walker(), walk = w.walk;

        function is_constant(node) {
                return node[0] == "string" || node[0] == "num";
        };

        function rmblock(block) {
                if (block != null && block[0] == "block" && block[1] && block[1].length == 1) {
                        var b = block[1][0];
                        if (!(b[0] == "if" && !b[3]))
                                block = b;
                }
                return block;
        };

        function rmthenblock(block) {
                var b = block;
                if (b[0] == "block" && b[1].length == 1) {
                        b = b[1][0];
                        for (var type; type = b[0];) {
                                if (type == "if") {
                                        if (!b[3]) // no else, we must keep the block
                                                return block;
                                        break;
                                }
                                else if (type == "while" || type == "do") b = b[2];
                                else if (type == "for") b = b[4];
                                else if (type == "for-in") b = b[4];
                                else break;
                        }
                }
                return rmblock(block);
        };

        function _lambda(name, args, body) {
                return [ this[0], name, args, join_vars(body.map(walk)) ];
        };

        function join_vars(statements) {
                for (var i = 0, ret = [], prev, cur; i < statements.length; ++i) {
                        cur = statements[i];
                        if (prev && cur[0] == "var" && prev[0] == "var") {
                                prev[1] = prev[1].concat(cur[1]);
                        } else {
                                ret.push(cur);
                                prev = cur;
                        }
                }
                return ret;
        };

        function best_of(ast1, ast2) {
                return gen_code(ast1).length > gen_code(ast2[0] == "stat" ? ast2[1] : ast2).length ? ast2 : ast1;
        };

        function aborts(t) {
                if (t[0] == "block" && t[1] && t[1].length > 0)
                        t = t[1][t[1].length - 1]; // interested in last statement
                if (t[0] == "return" || t[0] == "break" || t[0] == "continue" || t[0] == "throw")
                        return true;
        };

        return w.with_walkers({
                "sub": function(expr, subscript) {
                        if (subscript[0] == "string") {
                                var name = subscript[1];
                                if (is_identifier(name)) {
                                        return [ "dot", walk(expr), name ];
                                }
                        }
                },
                "if": function(c, t, e) {
                        c = walk(c);
                        t = walk(t);
                        e = rmblock(walk(e));
                        t = e ? rmthenblock(t) : rmblock(t);
                        var best = [ "if", c, t, e ];
                        if (t[0] == "stat") {
                                if (e) {
                                        if (e[0] == "stat") {
                                                // if (foo) bar(); else baz(); => foo ? bar() : baz();
                                                best = best_of(best, [ "stat", [ "conditional", c, t[1], e[1] ] ]);
                                        }
                                } else {
                                        // if no else is given, we could optimize as foo && bar();
                                        if (c[0] == "unary-prefix" && c[1] == "!") {
                                                best = best_of(best, [ "stat", [ "binary", "||", c[2], t[1] ]]);
                                        } else {
                                                best = best_of(best, [ "stat", [ "binary", "&&", c, t[1] ]]);
                                        }
                                }
                        } else if (e && t[0] == e[0] && (t[0] == "return" || t[0] == "throw")) {
                                best = best_of(best, [ t[0], [ "conditional", c, t[1], e[1] ] ]);
                        } else if (e && aborts(t)) {
                                best = [ [ "if", c, t ] ];
                                if (e[0] == "block") {
                                        if (e[1]) best = best.concat(e[1]);
                                } else {
                                        best.push(e);
                                }
                                best = [ "block", best ];
                        }
                        return best;
                },
                "for": function(init, cond, step, block) {
                        return [ "for", walk(init), walk(cond), walk(step), rmblock(walk(block)) ];
                },
                "for-in": function(has_var, key, hash, block) {
                        return [ "for-in", has_var, key, walk(hash), rmblock(walk(block)) ];
                },
                "while": function(cond, block) {
                        return [ "while", walk(cond), rmblock(walk(block)) ];
                },
                "do": function(cond, block) {
                        return [ "do", walk(cond), rmblock(walk(block)) ];
                },
                "with": function(obj, block) {
                        return [ "with", walk(obj), rmblock(walk(block)) ];
                },
                "toplevel": function(body) {
                        return [ "toplevel", join_vars(body.map(walk)) ];
                },
                "switch": function(expr, body) {
                        return [ "switch", walk(expr), join_vars(body.map(walk)) ];
                },
                "function": _lambda,
                "defun": _lambda,
                "block": function(body) {
                        if (body) return [ "block", join_vars(body.map(walk)) ];
                },
                "binary": function(op, left, right) {
                        left = walk(left);
                        right = walk(right);
                        var best = [ "binary", op, left, right ];
                        if (is_constant(left) && is_constant(right)) {
                                var val = null;
                                switch (op) {
                                    case "+": val = left[1] + right[1]; break;
                                    case "*": val = left[1] * right[1]; break;
                                    case "/": val = left[1] / right[1]; break;
                                    case "-": val = left[1] - right[1]; break;
                                }
                                if (val != null) {
                                        best = best_of(best, [ typeof val == "string" ? "string" : "num", val ]);
                                }
                        }
                        return best;
                }
        }, function() {
                return walk(ast);
        });

};

/* -----[ re-generate code from the AST ]----- */

var DOT_CALL_NO_PARENS = jsp.array_to_hash([
        "name",
        "array",
        "string",
        "dot",
        "sub",
        "call",
        "regexp"
]);

function gen_code(ast, beautify) {
        if (beautify) beautify = defaults(beautify, {
                indent_start : 0,
                indent_level : 4,
                quote_keys   : false
        });
        var indentation = 0,
            newline = beautify ? "\n" : "",
            space = beautify ? " " : "";

        function indent(line) {
                if (line == null)
                        line = "";
                if (beautify)
                        line = repeat_string(" ", beautify.indent_start + indentation * beautify.indent_level) + line;
                return line;
        };

        function with_indent(cont, incr) {
                if (incr == null) incr = 1;
                indentation += incr;
                try { return cont.apply(null, slice(arguments, 1)); }
                finally { indentation -= incr; }
        };

        function add_spaces(a) {
                if (beautify)
                        return a.join(" ");
                var b = [];
                for (var i = 0; i < a.length; ++i) {
                        var next = a[i + 1];
                        b.push(a[i]);
                        if (next &&
                            ((/[a-z0-9_\x24]$/i.test(a[i].toString()) && /^[a-z0-9_\x24]/i.test(next.toString())) ||
                             (/[\+\-]$/.test(a[i].toString()) && /^[\+\-]/.test(next.toString())))) {
                                b.push(" ");
                        }
                }
                return b.join("");
        };

        function add_commas(a) {
                return a.join("," + space);
        };

        var generators = {
                "string": make_string,
                "num": function(num) {
                        return String(num);
                },
                "name": make_name,
                "toplevel": function(statements) {
                        return make_block_statements(statements)
                                .join(newline + newline);
                },
                "block": make_block,
                "var": function(defs) {
                        return "var " + add_commas(defs.map(make_1vardef)) + ";";
                },
                "try": function(tr, ca, fi) {
                        var out = [ "try", make(tr) ], cbody;
                        if (ca) out.push("catch", "(" + ca[0] + ")", make(ca[1]));
                        if (fi) out.push("finally", make(fi));
                        return add_spaces(out);
                },
                "throw": function(expr) {
                        return add_spaces([ "throw", make(expr) ]) + ";";
                },
                "new": function(ctor, args) {
                        return add_spaces([ "new", make(ctor) + "(" + add_commas(args.map(make)) + ")" ]);
                },
                "switch": function(expr, body) {
                        return add_spaces([ "switch", "(" + make(expr) + ")", make_block(body) ]);
                },
                "case": function(expr) {
                        return add_spaces([ "\x08case", make(expr) + ":" ]);
                },
                "default": function() {
                        return "\x08default:";
                },
                "break": function(label) {
                        var out = "break";
                        if (label != null)
                                out += " " + make_name(label);
                        return out + ";";
                },
                "continue": function(label) {
                        var out = "continue";
                        if (label != null)
                                out += " " + make_name(label);
                        return out + ";";
                },
                "conditional": function(cond, the_then, the_else) {
                        return add_spaces([ make(cond), "?", make(the_then), ":", make(the_else) ]);
                },
                "assign": function(op, lvalue, rvalue) {
                        if (op && op !== true) op += "=";
                        else op = "=";
                        return add_spaces([ make(lvalue), op, make(rvalue) ]);
                },
                "dot": function(expr) {
                        var out = make(expr), i = 1;
                        if (!HOP(DOT_CALL_NO_PARENS, expr[0]))
                                out = "(" + out + ")";
                        while (i < arguments.length)
                                out += "." + make_name(arguments[i++]);
                        return out;
                },
                "call": function(func, args) {
                        var f = make(func);
                        if (!HOP(DOT_CALL_NO_PARENS, func[0]))
                                f = "(" + f + ")";
                        return f + "(" + add_commas(args.map(make)) + ")";
                },
                "function": make_function,
                "defun": make_function,
                "if": function(co, th, el) {
                        var out = [ "if", "(" + make(co) + ")", make(th) ];
                        if (el) {
                                out.push("else", make(el));
                        }
                        return add_spaces(out);
                },
                "for": function(init, cond, step, block) {
                        var out = [ "for" ];
                        init = (init != null ? make(init) : "").replace(/;*\s*$/, ";" + space);
                        cond = (cond != null ? make(cond) : "").replace(/;*\s*$/, ";" + space);
                        step = (step != null ? make(step) : "").replace(/;*\s*$/, "");
                        var args = init + cond + step;
                        if (args == "; ; ") args = ";;";
                        out.push("(" + args + ")", make(block));
                        return add_spaces(out);
                },
                "for-in": function(has_var, key, hash, block) {
                        var out = add_spaces([ "for", "(" ]);
                        if (has_var)
                                out += "var ";
                        out += add_spaces([ make_name(key) + " in " + make(hash) + ")", make(block) ]);
                        return out;
                },
                "while": function(condition, block) {
                        return add_spaces([ "while", "(" + make(condition) + ")", make(block) ]);
                },
                "do": function(condition, block) {
                        return add_spaces([ "do", make(block), "while", "(" + make(condition) + ")" ]);
                },
                "return": function(expr) {
                        var out = [ "return" ];
                        if (expr != null) out.push(make(expr));
                        return add_spaces(out) + ";";
                },
                "binary": function(operator, lvalue, rvalue) {
                        var left = make(lvalue), right = make(rvalue);
                        // XXX: I'm pretty sure other cases will bite here.
                        //      we need to be smarter.
                        //      adding parens all the time is the safest bet.
                        if (lvalue[0] == "assign" ||
                            lvalue[0] == "conditional" ||
                            lvalue[0] == "seq" ||
                            lvalue[0] == "binary" && PRECEDENCE[operator] > PRECEDENCE[lvalue[1]]) {
                                left = "(" + left + ")";
                        }
                        if (rvalue[0] == "assign" ||
                            rvalue[0] == "conditional" ||
                            lvalue[0] == "seq" ||
                            rvalue[0] == "binary" && PRECEDENCE[operator] >= PRECEDENCE[rvalue[1]]) {
                                right = "(" + right + ")";
                        }
                        return add_spaces([ left, operator, right ]);
                },
                "unary-prefix": function(operator, expr) {
                        var val = make(expr);
                        if (!(HOP(DOT_CALL_NO_PARENS, expr[0]) || expr[0] == "num"))
                                val = "(" + val + ")";
                        return operator + (jsp.is_alphanumeric_char(operator.charAt(0)) ? " " : "") + val;
                },
                "unary-postfix": function(operator, expr) {
                        var val = make(expr);
                        if (!(HOP(DOT_CALL_NO_PARENS, expr[0]) || expr[0] == "num"))
                                val = "(" + val + ")";
                        return val + operator;
                },
                "sub": function(expr, subscript) {
                        var hash = make(expr);
                        if (!HOP(DOT_CALL_NO_PARENS, expr[0]))
                                hash = "(" + hash + ")";
                        return hash + "[" + make(subscript) + "]";
                },
                "object": function(props) {
                        if (props.length == 0)
                                return "{}";
                        return "{" + newline + with_indent(function(){
                                return props.map(function(p){
                                        var key = p[0], val = make(p[1]);
                                        if (beautify && beautify.quote_keys || !is_identifier(key))
                                                key = make_string(key);
                                        return indent(add_spaces([ key, ":", val ]));
                                }).join("," + newline);
                        }) + newline + indent("}");
                },
                "regexp": function(rx, mods) {
                        return "/" + rx.replace(/\x2f/g, "\\x2f") + "/" + mods;
                },
                "array": function(elements) {
                        if (elements.length == 0) return "[]";
                        return add_spaces([ "[", add_commas(elements.map(make)), "]" ]);
                },
                "stat": function(stmt) {
                        return make(stmt).replace(/;*\s*$/, ";");
                },
                "seq": function() {
                        return add_commas(slice(arguments).map(make));
                },
                "label": function(name, block) {
                        return add_spaces([ make_name(name), ":", make(block) ]);
                },
                "with": function(expr, block) {
                        return add_spaces([ "with", "(" + make(expr) + ")", make(block) ]);
                },
                "atom": function(name) {
                        return make_name(name);
                }
        };

        function make_function(name, args, body) {
                var out = "function";
                if (name) {
                        out += " " + make_name(name);
                }
                out += "(" + add_commas(args.map(make_name)) + ")";
                return add_spaces([ out, make_block(body) ]);
        };

        function make_string(str) {
                // return '"' + str.replace(/\x5c/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t").replace(/\x22/g, "\\\"") + '"';
                return JSON.stringify(str); // still cheating.
        };

        function make_name(name) {
                return name.toString();
        };

        function make_block_statements(statements) {
                for (var a = [], last = statements.length - 1, i = 0; i <= last; ++i) {
                        var stat = statements[i];
                        var code = make(stat);
                        if (code != ";") {
                                if (!beautify && i == last)
                                        code = code.replace(/;+\s*$/, "");
                                a.push(code);
                        }
                }
                return a.map(indent);
        };

        function make_block(statements) {
                if (!statements) return ";";
                if (statements.length == 0) return "{}";
                return "{" + newline + with_indent(function(){
                        return make_block_statements(statements)
                                .join(newline);
                }) + newline + indent("}");
        };

        function make_1vardef(def) {
                var name = def[0], val = def[1];
                if (val != null)
                        name = add_spaces([ name, "=", make(val) ]);
                return name;
        };

        function make(node) {
                var type = node[0];
                var gen = generators[type];
                if (!gen)
                        throw new Error("Can't find generator for \"" + type + "\"");
                return gen.apply(type, node.slice(1));
        };

        var out = make(ast);
        if (beautify) {
                var rx = repeat_string(" ", beautify.indent_level / 2) + "\x08";
                rx = new RegExp(rx, "g");
                out = out.replace(rx, "");
        } else {
                out = out.replace(/\x08/g, "");
        }
        return out;
};

/* -----[ Utilities ]----- */

function repeat_string(str, i) {
        if (i <= 0) return "";
        if (i == 1) return str;
        var d = repeat_string(str, i >> 1);
        d += d;
        if (i & 1) d += str;
        return d;
};

function defaults(args, defs) {
        var ret = {};
        if (args === true)
                args = {};
        for (var i in defs) if (HOP(defs, i)) {
                ret[i] = (args && HOP(args, i)) ? args[i] : defs[i];
        }
        return ret;
};

function is_identifier(name) {
        return /^[a-z_$][a-z0-9_$]*$/i.test(name) &&
                !HOP(jsp.KEYWORDS_ATOM, name) &&
                !HOP(jsp.RESERVED_WORDS, name) &&
                !HOP(jsp.KEYWORDS, name);
};

function HOP(obj, prop) {
        return Object.prototype.hasOwnProperty.call(obj, prop);
};

/* -----[ Exports ]----- */

exports.ast_walker = ast_walker;
exports.ast_mangle = ast_mangle;
exports.ast_squeeze = ast_squeeze;
exports.gen_code = gen_code;
