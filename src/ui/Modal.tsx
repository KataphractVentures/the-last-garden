import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current;const focus=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';el?.showModal();return()=>{el?.close();document.body.style.overflow=overflow;focus?.focus({preventScroll:true});};},[]);
 return <dialog ref={dialog} aria-label={title} className={`modal ${wide?'wide':''}`} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}><header><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header><div className="modal-body">{children}</div></dialog>;
}
