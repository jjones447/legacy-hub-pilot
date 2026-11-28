// Fictional layout demonstration only. This is not the real eligibility gate.
export function respiteVisible(state){return state?.interest==='yes'||state?.interest==='maybe'||(Array.isArray(state?.supportNeeds)&&state.supportNeeds.includes('Respite care'))||state?.requestedBreak===true||state?.staffEnabled===true;}
export const examples=Object.freeze([
 {id:'example-dec02',label:'Wednesday, December 2',date:'2026-12-02',available:3},
 {id:'example-dec09',label:'Wednesday, December 9',date:'2026-12-09',available:2},
 {id:'example-dec16',label:'Wednesday, December 16',date:'2026-12-16',available:1},
 {id:'example-past',label:'Past example',date:'2026-11-10',available:4},
 {id:'example-full',label:'Full example',date:'2026-12-23',available:0}
]);
export const availableExamples=(today='2026-11-25')=>examples.filter(d=>d.date>=today&&d.available>0);
export function mountPreview(doc){
 const tabs=[...doc.querySelectorAll('[role=tab]')],panels=[...doc.querySelectorAll('[role=tabpanel]')];
 const respite=doc.getElementById('tab-respite'),scenario=doc.getElementById('scenario'),trigger=doc.getElementById('trigger');
 const picker=doc.getElementById('date-options'),summary=doc.getElementById('selection-summary');
 function selected(){const labels=[...picker.querySelectorAll('input:checked')].map(n=>availableExamples().find(d=>d.id===n.value)?.label).filter(Boolean);summary.textContent=labels.length?`Illustrative pending requests: ${labels.join('; ')}. Nothing is sent or saved; no place is reserved.`:'No example dates selected. Each date would be a request pending staff review.';}
 for(const date of availableExamples()){const label=doc.createElement('label');label.className='date-card';const input=doc.createElement('input');input.type='checkbox';input.value=date.id;const text=doc.createElement('span');text.textContent=date.label+' · Example available date';label.append(input,text);picker.append(label);input.addEventListener('change',selected);}
 function activate(tab,focus=false){if(tab.hidden)return;tabs.forEach(t=>{const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});panels.forEach(p=>{p.hidden=p.id!==tab.getAttribute('aria-controls');});if(focus)tab.focus();}
 tabs.forEach(tab=>{tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',event=>{const visible=tabs.filter(t=>!t.hidden);let index=visible.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%visible.length;else if(event.key==='ArrowLeft')index=(index+visible.length-1)%visible.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=visible.length-1;else return;event.preventDefault();activate(visible[index],true);});});
 function update(){const on=scenario.value==='needed';const mode=trigger.value;const state=on?{interest:mode==='yes'?'yes':mode==='maybe'?'maybe':'no',supportNeeds:mode==='needs'?['Respite care']:[],requestedBreak:mode==='request',staffEnabled:mode==='staff'}:{};const show=respiteVisible(state);const wasActive=respite.getAttribute('aria-selected')==='true';respite.hidden=!show;trigger.disabled=!on;doc.getElementById('eligibility-state').textContent=show?'Example: a confirmed respite-interest trigger is present; Respite Registration is visible.':'Example: no respite interest has been indicated; Respite Registration is hidden.';doc.getElementById('profile-interest').textContent=show?(mode==='maybe'?'Maybe — fictional example':mode==='yes'?'Yes — fictional example':'No profile interest selected; another confirmed trigger enables the example tab.'):'No — fictional example';if(!show){picker.querySelectorAll('input').forEach(i=>{i.checked=false;});selected();doc.getElementById('panel-respite').hidden=true;if(wasActive)activate(tabs[0],true);}}
 scenario.addEventListener('change',update);trigger.addEventListener('change',update);doc.getElementById('clear-dates').addEventListener('click',()=>{picker.querySelectorAll('input').forEach(i=>{i.checked=false;});selected();});activate(tabs[0]);selected();update();
}
if(typeof document!=='undefined')mountPreview(document);
