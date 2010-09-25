// -*- espresso -*-

defmacro mkobj(p1, v1, p2, v2, p3, v3) {
        var opt = this.gensym();
        var bar = [ "name", "while" ];
        return `{
                \p1: \v1,
                \p2: \v2,
                \p3: \(this.quote(v3)),
                \opt: "And some more",
                \bar: "even more"
        };
};

mkobj(foo, [ 1, 2, 3 ],
      bar, "some string here",
      baz, { a: 1, b: 2 });
