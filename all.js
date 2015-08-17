define(function(require, exports, module) {
    main.consumes = [
        "TestPanel", "ui", "Tree", "settings", "panels", "commands", "test"
    ];
    main.provides = ["test.all"];
    return main;

    function main(options, imports, register) {
        var TestPanel = imports.TestPanel;
        var settings = imports.settings;
        var panels = imports.panels;
        var ui = imports.ui;
        var Tree = imports.Tree;
        var test = imports.test;
        var commands = imports.commands;
        
        var async = require("async");
        var basename = require("path").basename;
        var dirname = require("path").dirname;
        var escapeHTML = require("ace/lib/lang").escapeHTML;

        /***** Initialization *****/

        var plugin = new TestPanel("Ajax.org", main.consumes, {
            caption: "All Tests",
            index: 200,
            style: "flex:1;-webkit-flex:1"
        });
        var emit = plugin.getEmitter();
        
        var tree, wsNode, rmtNode, btnRun, btnRunAll, stopping;
        
        function load() {
            // plugin.setCommand({
            //     name: "test",
            //     hint: "search for a command and execute it",
            //     bindKey: { mac: "Command-.", win: "Ctrl-." }
            // });
            
            panels.on("afterAnimate", function(){
                if (panels.isActive("test"))
                    tree && tree.resize();
            });
            
            // Menus
            // menus.addItemByPath("Run/Test", new ui.item({ 
            //     command: "commands" 
            // }), 250, plugin);
            
            commands.addCommand({
                name: "runtest",
                hint: "runs the selected test(s) in the test panel",
                // bindKey: { mac: "Command-O", win: "Ctrl-O" },
                group: "Test",
                exec: function(){
                    run(null, function(err){
                        if (err) console.log(err);
                    });
                }
            }, plugin);
        }
        
        var drawn = false;
        function draw(opts) {
            if (drawn) return;
            drawn = true;
            
            // Insert CSS
            ui.insertCss(require("text!./style.css"), options.staticPrefix, plugin);
            
            // Buttons
            var toolbar = test.getElement("toolbar");
            
            btnRun = ui.insertByIndex(toolbar, new ui.button({
                caption: "Run Test",
                skinset: "default",
                skin: "c9-menu-btn",
                command: "runtest"
            }), 100, plugin);
            
            btnRunAll = ui.insertByIndex(toolbar, new ui.button({
                caption: "Run All",
                skinset: "default",
                skin: "c9-menu-btn"
            }), 100, plugin);
            
            // Tree
            tree = new Tree({
                container: opts.html,
            
                getCaptionHTML: function(node) {
                   if (node.type == "file") {
                        var path = dirname(node.label);
                        return basename(path) + "/" + basename(node.label) 
                            + "<span class='extrainfo'> - " + dirname(path) + "</span>";
                   }
                   else if (node.type == "all") {
                       return escapeHTML(node.label) + " (" + node.items.length + ")";
                   }
                   else if (node.type == "describe") {
                       return "<span style='opacity:0.5;'>" + escapeHTML(node.label) + "</span>";
                   }
                   else if (node.kind == "it") {
                       return "it " + escapeHTML(node.label);
                   }
                   
                   return escapeHTML(node.label);
                },
            
                getIconHTML: function(node) {
                    var icon = "default";
                    
                    if (node.status === "loading") icon = "loading";
                    else if (node.status === "running") icon = "test-in-progress";
                    else if (node.passed === 1) icon = "test-passed";
                    else if (node.passed === 0) icon = "test-failed";
                    else if (node.passed === 2) icon = "test-error";
                    else if (node.passed === 3) icon = "test-terminated";
                    else if (node.passed === -1) icon = "test-ignored";
                    else if (node.type == "describe") icon = "folder";
                    
                    return "<span class='ace_tree-icon " + icon + "'></span>";
                },
                
                getClassName: function(node) {
                    return (node.className || "") 
                        + (node.status == "loading" ? " loading" : "")
                        + (node.status == "running" ? " loading" : ""); // TODO different running icon
                },
                
                getRowIndent: function(node) {
                    return node.$depth ? node.$depth - 1 : 0;
                },
                
                // Tree Events
                loadChildren: function(node, callback){
                    populate(node, callback);
                },
                
                // sort: function(children) {
                //     var compare = tree.model.alphanumCompare;
                //     return children.sort(function(a, b) {
                //         // TODO index sorting
                //         // if (aIsSpecial && bIsSpecial) return a.index - b.index; 
                
                //         return compare(a.name + "", b.name + "");
                //     });
                // }
            }, plugin);
            
            tree.container.style.position = "absolute";
            tree.container.style.left = "10px";
            tree.container.style.top = "10px";
            tree.container.style.right = "10px";
            tree.container.style.bottom = "10px";
            tree.container.style.height = "";
            
            wsNode = {
                label: "workspace",
                isOpen: true,
                className: "heading",
                status: "loaded",
                noSelect: true,
                $sorted: true,
                
                items: []
            };
            rmtNode = {
                label: "remote",
                isOpen: true,
                className: "heading",
                status: "loaded",
                noSelect: true,
                $sorted: true,
                
                items: []
            };
            
            tree.setRoot({
                label: "root",
                items: [wsNode, rmtNode]
            });
            
            // Initiate test runners
            test.on("register", function(e){ init(e.runner) }, plugin);
            test.on("unregister", function(e){ deinit(e.runner) }, plugin);
            
            test.runners.forEach(init);
        }
        
        /***** Helper Methods *****/
        
        function populate(node, callback){
            var runner = findRunner(node);
            
            updateStatus(node, "loading");
            
            runner.populate(node, function(err){
                if (err) return callback(err); // TODO
                
                updateStatus(node, "loaded");
                
                callback();
            });
        }
        
        function findRunner(node){
            while (!node.runner) node = node.parent;
            return node.runner;
        }
        
        function init(runner){
            var parent = runner.remote ? rmtNode : wsNode;
            parent.items.push(runner.root);
            
            updateStatus(runner.root, "loading");
            
            runner.init(runner.root, function(err){
                if (err) return console.error(err); // TODO
                
                updateStatus(runner.root, "loaded");
            });
        }
        
        function deinit(runner){
            if (runner.root.parent) {
                var items = runner.root.parent.items;
                items.splice(items.indexOf(runner.root), 1);
            }
            
            tree.refresh();
        }
        
        /***** Methods *****/
        
        function run(nodes, parallel, callback){
            if (typeof parallel == "function")
                callback = parallel, parallel = false;
            
            if (!nodes)
                nodes = tree.selectedNodes;
            
            if (parallel === undefined)
                parallel = settings.getBool("shared/test/@parallel"); // TODO have a setting per runner
            
            var list = [];
            nodes.forEach(function(n){
                if (n.type == "all" || n.type == "root")
                    getAllNodes(n, "file").forEach(function(n){ list.push(n); });
                else
                    list.push(n);
            });
            
            // TODO influence run button
            // TODO clear all previous states of list before running any
                
            async[parallel ? "each" : "eachSeries"](list, function(node, callback){
                if (node.status == "pending") // TODO do this lazily
                    return populate(node, function(err){
                        if (err) return callback(err);
                        _run(node, callback);
                    });
                
                _run(node, callback);
            }, function(err){
                if (err) return callback(err);
                
                // TODO influence run button
                
                callback();
            });
        }
        
        var progress = {
            log: function(chunk){
                emit("log", chunk); console.log(chunk)
            },
            start: function(node){
                updateStatus(node, "running");
            },
            end: function(node){
                updateStatus(node, "loaded");
            }
        }
        
        function _run(node, callback){
            var runner = findRunner(node);
            
            updateStatus(node, "running");
            
            runner.run(node, progress, function(err){
                if (err) return callback(err);
                
                updateStatus(node, "loaded");
                
                callback();
            });
        }
        
        function getAllNodes(node, type){
            var nodes = [];
            (function recur(items){
                for (var j, i = 0; i < items.length; i++) {
                    j = items[i];
                    if (j.type.match(type)) nodes.push(j);
                    else if (j.items) recur(j.items);
                }
            })([node]);
            
            return nodes;
        }
        
        function updateStatus(node, s){
            // TODO make this more efficient by trusting the child nodes
            if (node.type == "file" || node.type == "describe") {
                var tests = getAllNodes(node, /test|prepare/);
                
                var st, p = [];
                tests.forEach(function(test){
                    if (st === undefined && test.status != "loaded")
                        st = test.status;
                    if (!p[test.passed]) p[test.passed] = 0;
                    p[test.passed]++;
                });
                
                node.passed = p[3] ? 3 : (p[2] ? 2 : p[0] ? 0 : (p[1] ? 1 : undefined));
                node.status = st || "loaded";
            }
            else if (node.type == "all" && node.type == "root") {
                tree.refresh();
                return;
            }
            else {
                node.status = s;
            }
            
            if (node.parent) updateStatus(node.parent, s);
            else tree.refresh();
        }
        
        function stop(){
            // TODO
            stopping = true;
        }
        
        // function applyFilter() {
        //     model.keyword = filterbox && filterbox.getValue();

        //     if (!model.keyword) {
        //         model.reKeyword = null;
        //         model.setRoot(model.cachedRoot);

        //         // model.isOpen = function(node){ return node.isOpen; }
        //     }
        //     else {
        //         model.reKeyword = new RegExp("("
        //             + util.escapeRegExp(model.keyword) + ")", 'i');
        //         var root = search.treeSearch(model.cachedRoot.items, model.keyword, true);
        //         model.setRoot(root);

        //         // model.isOpen = function(node){ return true; };
        //     }
        // }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("draw", function(e) {
            draw(e);
        });
        plugin.on("show", function(e) {
            // txtFilter.focus();
            // txtFilter.select();
        });
        plugin.on("hide", function(e) {
            // Cancel Preview
            // tabs.preview({ cancel: true });
        });
        plugin.on("unload", function(){
            drawn = false;
            tree = null;
        });
        
        /***** Register and define API *****/
        
        /**
         * This is an example of an implementation of a plugin. Check out [the source](source/template.html)
         * for more information.
         * 
         * @class Template
         * @extends Plugin
         * @singleton
         */
        plugin.freezePublicAPI({
            /**
             * @property {Object}  The tree implementation
             * @private
             */
            get tree() { return tree; },
            
            /**
             * 
             */
            run: run
        });
        
        register(null, {
            "test.all": plugin
        });
    }
});