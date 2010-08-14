if (foo) {
        while(true) {
                if (bar) {
                        baz();
                }
        }
} else {
        caz();
}

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
