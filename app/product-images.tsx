"use client";
import {useEffect,useRef,useState} from 'react';
import type {Product} from '../lib/model';
import './product-images.css';

export default function ProductImages({product,gallery=false}:{product:Partial<Product>;gallery?:boolean}){
 const images=product.images||[],dialog=useRef<HTMLDialogElement>(null),[index,setIndex]=useState(0),[opened,setOpened]=useState(false);
 useEffect(()=>{setIndex(i=>Math.min(i,Math.max(0,images.length-1)));if(!images.length){dialog.current?.close();setOpened(false);}},[images.length]);
 useEffect(()=>{if(!opened)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setIndex(i=>(i+(e.key==='ArrowLeft'?-1:1)+images.length)%images.length);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[opened,images.length]);
 if(!images.length)return null;
 const close=()=>{dialog.current?.close();setOpened(false);};
 function open(i:number){setIndex(i);setOpened(true);dialog.current?.showModal();}
 return <div className={gallery?'warehouse-product-gallery':'warehouse-product-thumb'}>
  {(gallery?images:images.slice(0,1)).map((image,i)=><button type="button" key={image.id} className="warehouse-image-button" onClick={()=>open(i)} aria-label={`查看${product.name||'商品'}图片${i+1}`}><img src={image.thumbnail_url} alt={product.name||'商品图片'} loading="lazy" decoding="async" referrerPolicy="no-referrer"/></button>)}
  <dialog className="warehouse-image-viewer" ref={dialog} onCancel={()=>setOpened(false)} onClose={()=>setOpened(false)} onClick={e=>{if(e.target===e.currentTarget)close();}}>
   <header><span>{product.name} · {index+1}/{images.length}</span><button type="button" onClick={close} aria-label="关闭图片">关闭 ×</button></header>
   <div className="warehouse-image-stage"><button type="button" onClick={()=>setIndex((index-1+images.length)%images.length)} aria-label="上一张图片" disabled={images.length<2}>‹</button><img src={opened?images[index]?.url:undefined} alt={product.name||'商品大图'} referrerPolicy="no-referrer"/><button type="button" onClick={()=>setIndex((index+1)%images.length)} aria-label="下一张图片" disabled={images.length<2}>›</button></div>
  </dialog>
 </div>;
}
