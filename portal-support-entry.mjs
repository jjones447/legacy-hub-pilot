// Called ONLY by the owning app/session composition after verified session state.
// This bridge never parses cookies, derives identity or initiates login/mail.
import {mountSupportForm} from './portal-support-ui.mjs';
import {mountStaffSupport} from './portal-support-staff-ui.mjs';
import {supportTransport,staffSupportTransport} from './portal-support-transport.mjs';
// Pure page mount: caller validates /me before invoking; mounting itself does not fetch.
export function mount(root,transport){
 const view=mountSupportForm(root,transport),originalDispose=view.dispose;
 let unregister=null;
 view.dispose=()=>{const release=unregister;unregister=null;try{release?.();}finally{originalDispose();}};
 const win=root.ownerDocument.defaultView;
 try{if(typeof win?.registerPortalSupportView==='function'){
  const release=win.registerPortalSupportView(view);
  if(typeof release!=='function')throw Error('Support registration must return unregister');
  unregister=release;
 }}catch(error){view.dispose();throw error;}
 return view;
}
export function createSupportMounts(document,fetchImpl){
 let owner=null,staff=null;
 const ownerRoot=()=>document.getElementById('portalFunctionalSupport');
 const staffRoot=()=>document.getElementById('staffFunctionalSupport');
 const api={
  mountOwner(checkedFetch=fetchImpl){if(typeof checkedFetch!=='function')throw Error('Validated Support session fetch is required');api.resetOwner();const root=ownerRoot();if(!root)return null;root.hidden=false;owner=mount(root,supportTransport(checkedFetch));void owner.history();return owner;},
  resetOwner(){owner?.dispose();owner=null;const root=ownerRoot();if(root){root.replaceChildren();root.hidden=true;}},
  mountStaff(){api.resetStaff();const root=staffRoot();if(!root)return null;root.hidden=false;staff=mountStaffSupport(root,staffSupportTransport(fetchImpl));void staff.load();return staff;},
  resetStaff(){staff?.dispose();staff=null;const root=staffRoot();if(root){root.replaceChildren();root.hidden=true;}},
  dispose(){api.resetOwner();api.resetStaff();}
 };return api;
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 window.LegacySupportMounts=createSupportMounts(document);
 window.dispatchEvent(new Event('legacy-support-mounts-ready'));
}

// Presentation-only lifecycle. The supplied revalidate callback is owned by the
// authenticated session module. Nothing starts until caller invokes start/events.
export function bindOwnerPageLifecycle(view,root,revalidate,win=root.ownerDocument.defaultView){
 let epoch=0,closed=false;const baseReset=view.reset,baseDispose=view.dispose;
 view.reset=()=>{if(closed)return;epoch++;root.hidden=true;baseReset();};
 async function start(){if(closed)return false;const generation=++epoch;root.hidden=true;
  try{await revalidate();if(closed||epoch!==generation)return false;root.hidden=false;await view.history();return !closed&&epoch===generation&&!root.hidden;}
  catch{if(!closed&&epoch===generation)view.reset();return false;}
 }
 const hide=()=>view.reset(),show=()=>{void start();};
 win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);win.addEventListener('focus',show);
 view.dispose=()=>{if(closed)return;view.reset();closed=true;win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);win.removeEventListener('focus',show);baseDispose();};
 return {start,reset:()=>view.reset(),dispose:()=>view.dispose()};
}
