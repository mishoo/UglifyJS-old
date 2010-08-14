if (foo) {
        while(true) {
                if (bar) {
                        baz();
                }
        }
} else {
        caz();
}

cond ? foo() : bar();

if (cond)
        foo();
else
        bar();

if (cond)
        foo();

if (foo) {
        for(;;) {
                if (bar) {
                        baz();
                }
        }
} else {
        caz();
}

if (foo) {
        for(var i in parc) {
                if (bar) {
                        baz();
                } else {foo;}
        }
} else {
        caz();
}

if (foo) while(true) {
        if (bar) foo();
} else {
        mak();
}

(function(){
        if (foo) {
                return "bar";
        } else {
                baz();
        }
})();
