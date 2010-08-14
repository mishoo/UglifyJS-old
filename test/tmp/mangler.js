(function(foo){
        var bar = 10;
        var baz = 20;
        var caz = 30;
        return function g() {
                var baz = 5, maka = 10, m2, m3, m4;
                g();
                return bar + baz + caz + foo;
        };
})();

(function(b){
        // B remains unmangled because eval is used in sub-scope
        (function(){ return eval("parc") })(); // so we have eval
        (function(){
                // here we are safe from eval() so this scope is mangled
                var foo = 5;
                // but bar should NOT mangle to b, because we reference it!
                var bar = 10;
                return b + foo + bar;
        })();
})();

(function(){
        var mak = 10;           // mangles to 'a'
        out(function(){
                var q;          // should NOT mangle to 'a', because
                                // it would shadow a name that is in
                                // use below:
                return (function(){
                        return mak;
                })();
        });
        out(function(){
                var q = 5;      // can (and does) mangle to 'a'
                return q;
        });
})();

// reference a() -- a name possibly defined elsewhere.  Make sure we
// don't shadow it with a mangled name.
(function(){
        var mak = 10;           // should NOT mangle to 'a'
        return (function(){
                return a(mak);
        })();
})();
