// -*- espresso -*-

defmacro ensure_ordered(a:name, b:name) {
        var tmp = this.gensym();
        return @if (\a > \b) {
                var \tmp = \a;
                \a = \b;
                \b = \tmp;
        };
}

defstat defun_region(name:name, (args:name*), b:block) {
        var p1 = args[0], p2 = args[1];
        return @function \name (\p1, \p2) {
                ensure_ordered(p1, p2);
                \@b
        };
}

// ensure_ordered(foo, bar);

defun_region foo(start, stop) {
        for (var i = start; i <= stop; ++i) {
                print(getChar(i));
        }
}
