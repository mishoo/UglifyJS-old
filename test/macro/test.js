// -*- espresso -*-

// defmacro test(a:name, b, c:statement) {
//         return [ "block", [ [ "binary", "+", [ "name", a ], b ] ].concat(c) ];
// }

// test(foo, { parc: "mak" }, {
//         var bar = 10;
//         check(this.out());
// });

// defmacro order(a:name, b:name) {
//         var tmp = this.gensym();
//         return @{
//                 if (\a > \b) {
//                         var \tmp = \a;
//                         \a = \b;
//                         \b = \tmp;
//                 }
//                 crap();
//         };
// };

defmacro order(a:name, b:name) {
        var tmp = this.gensym();
        return `if (\a > \b) {
                var \tmp = \a;
                \a = \b;
                \b = \tmp;
        };
};

// defmacro with_orderd(a:name, b:name, c:statement) {
//         return @{
//                 order(\a, \b);
//                 \c;
//         };
// };

defmacro with_orderd(a:name, b:name, c:statement) {
        var tmp = this.gensym();
        return `(function(\a, \b){
                if (\a > \b) {
                        var \tmp = \a;
                        \a = \b;
                        \b = \tmp;
                }
                \c;
        })(\a, \b);
};

with_orderd(crap, mak, {
        print("Smallest is " + crap);
        print("And " + mak + " follows");
        order(mak, crap);
        print("Reverse order: " + mak + ", " + crap);
});

with_orderd(
        foo, bar,
        print("order: " + foo + ", " + bar)
);

// defmacro order(a:name, b:name) {
//         var tmp = this.gensym();
//         return `(function(\tmp){
//                 \a = \b;
//                 \b = \tmp;
//         })(\a);
// };

var foo = 10;
var bar = 20;
order(foo, bar);

// defmacro qwe (a) {
//         var tmp = this.symbol("crapmak");
//         return @{
//                 var \tmp = \a;
//                 ++\tmp;
//         };
// }

// var a = 5;
// qwe(a);


defstat unless(cond, b:statement) {
        sys.log("********************************************");
        INSPECT(cond);
        return @if (!\cond) \b;
}

unless (foo + bar < 10) {
        crap();
        mak();
}

(function(){
        unless (foo + bar < 10) unless (bar) return @if (baz) {
                crap();
        }
})();
