var jsp = require("./parse-js"),
    slice = jsp.slice;

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
                for (i in walkers) if (walkers.hasOwnProperty(i)) {
                        save[i] = user[i];
                        user[i] = walkers[i];
                }
                try { return cont(); }
                finally {
                        for (i in save) if (save.hasOwnProperty(i)) {
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

/* -----[ scope and compression ]----- */

function Scope(parent) {
        this.names = {};        // names defined in this scope
        this.refs = {};         // names referenced from this scope
        this.uses_with = false; // will become TRUE if eval() is detected in this or any subscopes
        this.uses_eval = false; // will become TRUE if with() is detected in this or any subscopes
        this.parent = parent;   // parent scope
};

Scope.prototype = {
        has: function(name) {
                var s = this;
                while (s) {
                        if (s.names.hasOwnProperty(name)) return s;
                        s = s.parent;
                }
                return false;
        },
        toJSON: function() {
                return {
                        names: this.names,
                        uses_eval: this.uses_eval,
                        uses_with: this.uses_with
                };
        }
};

function ast_add_scope(ast) {

        var scope_chain = [];
        var current_scope = null;
        var w = ast_walker(), walk = w.walk;
        var scopes_with_eval = [];

        function with_new_scope(cont) {
                var old = current_scope;
                current_scope = new Scope(old);
                scope_chain.push(current_scope);
                try {
                        var ret = cont();
                        ret.scope = current_scope;
                        return ret;
                }
                finally {
                        scope_chain.pop();
                        current_scope = old;
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

        function _with(expr, block) {
                for (var i = scope_chain.length; --i >= 0;)
                        scope_chain[i].uses_with = true;
        };

        function _var(defs) {
                defs.map(function(d){ define(d[0]) });
        };

        function _for_in(has_var, name) {
                if (has_var) define(name);
        };

        function _try(t, c, f) {
                if (c != null) {
                        return [
                                "try",
                                walk(t),
                                with_new_scope(function(){
                                        return [ define(c[0]), walk(c[1]) ];
                                }),
                                walk(f)
                        ];
                }
        };

        function _call(expr, args) {
                if (expr[0] == "name" && expr[1] == "eval")
                        scopes_with_eval.push(current_scope);
        };

        function _name(name) {
                reference(name);
        };

        ast = with_new_scope(function(){
                return w.with_walkers({
                        "function" : _lambda,
                        "defun"    : _lambda,
                        "with"     : _with,
                        "var"      : _var,
                        "try"      : _try,
                        "call"     : _call,
                        "name"     : _name,
                        "for-in"   : _for_in
                }, function(){
                        return walk(ast);
                });
        });

        scopes_with_eval.map(function(scope){
                if (!scope.has("eval")) {
                        while (scope) {
                                scope.uses_eval = true;
                                scope = scope.parent;
                        }
                }
        });

        return ast;

};

/* -----[ mangle names ]----- */

function ast_mangle(ast, do_toplevel) {
        var w = ast_walker(), walk = w.walk, scope, cname = '@';

        function _next_mangled() {
                var next;
                if (cname.charAt(0) == "$") next = "$" + (parseInt(cname.substr(1), 10) + 1);
                else if (cname < "Z") next = String.fromCharCode(cname.charCodeAt(0) + 1);
                else if (cname == "Z") next = "a";
                else if (cname < "z") next = String.fromCharCode(cname.charCodeAt(0) + 1);
                else next = "$1";
                cname = next;
                return next;
        };

        // XXX: we could be smarter here.
        function next_mangled() {
                do {
                        var m = _next_mangled();
                        var s = scope.has(m);
                        if (!s || !(s.uses_eval || s.uses_with))
                                return m;
                } while(true);
        };

        function get_mangled(name, newMangle) {
                if (!do_toplevel && !scope.parent) return name; // don't mangle toplevel
                if (scope.uses_eval || scope.uses_with) return name; // no mangle if with or eval is used
                var s = scope.has(name);
                if (!s) return name; // not in visible scope, no mangle
                var m = s.mangled || (s.mangled = {});
                if (m.hasOwnProperty(name)) return m[name]; // already mangled
                return newMangle ? (m[name] = next_mangled()) : name;
        };

        function _lambda(name, args, body) {
                name = get_mangled(name);
                body = with_scope(body.scope, function(){
                        args = args.map(function(name){ return get_mangled(name) });
                        return body.map(walk);
                });
                return [ this[0], name, args, body ];
        };

        function _var(defs) {
                return [ "var", defs.map(function(d){
                        return [ get_mangled(d[0]), walk(d[1]) ];
                })];
        };

        function _name(name) {
                return [ "name", get_mangled(name) ];
        };

        function _try(t, c, f) {
                return [ "try",
                         walk(t),
                         c ? with_scope(c.scope, function(){
                                 return [ get_mangled(c[0]), walk(c[1]) ];
                         }) : null,
                         walk(f) ];
        };

        function with_scope(s, cont) {
                var _scope = scope, _cname = cname;
                scope = s;
                for (var i in s.names) if (s.names.hasOwnProperty(i)) {
                        get_mangled(i, true);
                }
                try { return cont(); }
                finally {
                        scope = _scope;
                        cname = _cname;
                };
        };

        function _toplevel(body) {
                return with_scope(this.scope, function(){
                        return [ "toplevel", body.map(walk) ];
                });
        };

        function _for_in(has_var, name, obj, stat) {
                return [ "for-in", has_var, get_mangled(name), walk(obj), walk(stat) ];
        };

        return w.with_walkers({
                "function": _lambda,
                "defun": _lambda,
                "var": _var,
                "name": _name,
                "try": _try,
                "toplevel": _toplevel,
                "for-in": _for_in
        }, function() {
                return walk(ast_add_scope(ast));
        });
};

/* -----[
   - compress foo.["bar"] into foo.bar,
   - remove block brackets {} where possible
   - join consecutive var declarations
   ]----- */

function ast_squeeze(ast) {

        var w = ast_walker(), walk = w.walk;

        function is_constant(node) {
                return node[0] == "string" || node[0] == "num";
        };

        function rmblock(block) {
                if (block != null && block[0] == "block" && block[1].length == 1)
                        block = block[1][0];
                return block;
        };

        function _lambda(name, args, body) {
                return [ this[0], name, args, join_vars(body.map(walk)) ];
        };

        function join_vars(statements) {
                var ret = [], prev, cur;
                for (var i = 0; i < statements.length; ++i) {
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

        return w.with_walkers({
                "sub": function(expr, subscript) {
                        if (subscript[0] == "string") {
                                var name = subscript[1];
                                if (jsp.is_identifier(name)) {
                                        return [ "dot", walk(expr), name ];
                                }
                        }
                },
                "if": function(c, t, e) {
                        c = walk(c);
                        t = walk(t);
                        e = walk(e);
                        // in one situation we can't squeeze the "then" block:
                        // if it's a single "if" statement without an "else" branch, and we do have an "else" branch.
                        if (!(e && t[0] == "block" && t[1].length == 1 && t[1][0][0] == "if" && !t[1][0][3]))
                                t = rmblock(t);
                        return [ "if", c, t, rmblock(e) ];
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
                "function": _lambda,
                "defun": _lambda,
                "block": function(body) {
                        if (body) return [ "block", join_vars(body.map(walk)) ];
                },
                "binary": function(op, left, right) {
                        left = walk(left);
                        right = walk(right);
                        if (is_constant(left) && is_constant(right)) {
                                var val = null;
                                switch (op) {
                                    case "+": val = left[1] + right[1]; break;
                                    case "*": val = left[1] * right[1]; break;
                                    case "/": val = left[1] / right[1]; break;
                                    case "-": val = left[1] - right[1]; break;
                                }
                                if (val != null) {
                                        val = [ typeof val == "string" ? "string" : "num", val ];
                                        // any savings? 1/3 would translate to 0.3333333333333333, so it's worth checking.
                                        var s1 = jsp.gen_code([ "binary", op, left, right ]),
                                            s2 = jsp.gen_code(val);
                                        if (s2.length < s1.length)
                                                return val;
                                }
                        }
                        return [ "binary", op, left, right ];
                }
        }, function() {
                return walk(ast);
        });

};

exports.ast_walker = ast_walker;
exports.ast_mangle = ast_mangle;
exports.ast_squeeze = ast_squeeze;
