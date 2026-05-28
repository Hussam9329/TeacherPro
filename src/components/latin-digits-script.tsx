'use client';

/**
 * Injects a <script> that runs before paint to:
 * 1. Replace all Arabic/Persian digits in existing DOM text nodes with Latin.
 * 2. Set up a MutationObserver to catch and fix any future injected digits.
 */
export function LatinDigitsScript() {
  const scriptContent = `
(function(){
  var MAP={1570:'0',1571:'1',1572:'2',1573:'3',1574:'4',1575:'5',1576:'6',1577:'7',1578:'8',1579:'9',1776:'0',1777:'1',1778:'2',1779:'3',1780:'4',1781:'5',1782:'6',1783:'7',1784:'8',1785:'9'};
  var RE=/[\\u0660-\\u0669\\u06F0-\\u06F9]/g;
  function fix(t){return t.replace(RE,function(c){return MAP[c.charCodeAt(0)]||c});}
  function walk(root){
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false);
    var n;
    while(n=w.nextNode()){
      if(RE.test(n.textContent)){n.textContent=fix(n.textContent);}
    }
  }
  function init(){
    walk(document.body||document.documentElement);
    if(typeof MutationObserver!=='undefined'){
      new MutationObserver(function(mutations){
        mutations.forEach(function(m){
          m.addedNodes.forEach(function(node){
            if(node.nodeType===3){if(RE.test(node.textContent)){node.textContent=fix(node.textContent);}}
            else if(node.nodeType===1){walk(node);}
          });
        });
      }).observe(document.body||document.documentElement,{childList:true,subtree:true});
    }
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
  else{init();}
})();
`;

  return <script dangerouslySetInnerHTML={{ __html: scriptContent }} />;
}
