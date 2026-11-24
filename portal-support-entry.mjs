// Called ONLY by the owning app/session composition after verified session state.
// This bridge never parses cookies, derives identity or initiates login/mail.
import {mountSupportForm} from './portal-support-ui.mjs';
import {mountStaffSupport} from './portal-support-staff-ui.mjs';
import {supportTransport,staffSupportTransport} from './portal-support-transport.mjs';
export function createSupportMounts(document,fetchImpl=globalThis.fetch){
 let owner=null,staff=null;
 const ownerRoot=()=>document.getElementById('portalFunctionalSupport');
 const staffRoot=()=>document.getElementById('staffFunctionalSupport');
 const api={
  mountOwner(){api.resetOwner();const root=ownerRoot();if(!root)return null;root.hidden=false;owner=mountSupportForm(root,supportTransport(fetchImpl));void owner.history();return owner;},
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
