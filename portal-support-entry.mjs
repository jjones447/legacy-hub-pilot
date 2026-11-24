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
export function createSupportMounts(document,fetchImpl=globalThis.fetch){
 let owner=null,staff=null;
 const ownerRoot=()=>document.getElementById('portalFunctionalSupport');
 const staffRoot=()=>document.getElementById('staffFunctionalSupport');
 const api={
  mountOwner(){api.resetOwner();const root=ownerRoot();if(!root)return null;root.hidden=false;owner=mount(root,supportTransport(fetchImpl));void owner.history();return owner;},
  resetOwner(){owner?.dispose();owner=null;const root=ownerRoot();if(root){root.replaceChildren();root.hidden=true;}},
  mountStaff(){api.resetStaff();const root=staffRoot();if(!root)return null;root.hidden=false;staff=mountStaffSupport(root,staffSupportTransport(fetchImpl));void staff.load();return staff;},
  resetStaff(){staff?.dispose();staff=null;const root=staffRoot();if(root){root.replaceChildren();root.hidden=true;}},
  dispose(){api.resetOwner();api.resetStaff();}
 };return api;
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 window.LegacySupportMounts=createSupportMounts(document);
 window.dispatchEvent(new Event('legacy-support-mounts-ready'));
 window.addEventListener('pagehide',()=>window.LegacySupportMounts.dispose());
}
