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


(function(B){
        // B remains unmangled because eval is used in sub-scope
        (function(){ return eval("parc") })(); // so we have eval
        (function(){
                // here we are safe from eval() so this scope is mangled
                var foo = 5;
                // but bar should NOT mangle to B, because we reference it!
                var bar = 10;
                return B + foo + bar;
        })();
})();

(function(){
        var mak = 10;
        return (function(){
                var q;
                return (function(){
                        return mak;
                })();
        })();
})();
