"use client";
import {Component,createContext,useContext,type ReactNode} from 'react';

const ActiveView=createContext(true);
export function useViewActive(){return useContext(ActiveView);}
type Props={active:boolean;children:()=>ReactNode};
type State={content:ReactNode};
/** Retain visited DOM and local filters; frozen props prevent hidden-page work. */
export default class RetainedView extends Component<Props,State>{
 state:State={content:null};
 static getDerivedStateFromProps(props:Props){return props.active?{content:props.children()}:null;}
 render(){return <div hidden={!this.props.active} inert={!this.props.active} className="retained-view"><ActiveView.Provider value={this.props.active}>{this.state.content}</ActiveView.Provider></div>;}
}
