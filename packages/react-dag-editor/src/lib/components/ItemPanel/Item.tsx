import { mergeStyles } from "@fluentui/merge-styles";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { v4 as uuid } from "uuid";
import { emptyNodeConfig } from "../../built-in/emptyNodeConfig";
import { defaultGetPositionFromEvent, DragController } from "../../controllers";
import { PointerEventProvider } from "../../event-provider/PointerEventProvider";
import { GraphFeatures } from "../../Features";
import { useGraphConfig, useGraphController } from "../../hooks/context";
import { useRefValue } from "../../hooks/useRefValue";
import type { INodeConfig } from "../../models/config/types";
import { GraphCanvasEvent } from "../../models/event";
import type {
  IContainerRect,
  IPoint,
  ITransformMatrix,
} from "../../models/geometry";
import { ICanvasNode } from "../../models/node";
import {
  getRectHeight,
  getRectWidth,
  isViewportComplete,
  reverseTransformPoint,
} from "../../utils";
import { isMouseButNotLeft } from "../../utils/mouse";
import { noop } from "../../utils/noop";
import classes from "../Graph.styles.module.scss";
import { AddingNodeSvg } from "./AddingNodeSvg";

export interface IItemProps<N = unknown, P = unknown> {
  /**
   * Custom styling for the Item
   */
  style?: React.CSSProperties;
  /**
   * ClassName for the Item
   */
  className?: string;
  /**
   * Triggered just before drag the model node from the item panel
   */
  dragWillStart?(node: ICanvasNode): void;
  getNode(): Partial<ICanvasNode<N, P>>;
}

const el = document.createElement("div");
document.body.appendChild(el);

/**
 * @param rect the container clement bounding box rect
 * @param clientX point: x
 * @param clientY point: y
 *
 * @returns boolean value to indicate whether the point is in bound or not.
 */
function isWithInBound(
  rect: IContainerRect,
  clientX: number,
  clientY: number
): boolean {
  const { top, right, bottom, left } = rect;
  return (
    clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
  );
}

const adjustedClientPoint = (
  x: number,
  y: number,
  rect: IContainerRect | undefined | null,
  transformMatrix: ITransformMatrix
): IPoint => {
  let adjustedX = x;
  let adjustedY = y;

  if (rect) {
    const { left, top } = rect;
    adjustedX = x - left;
    adjustedY = y - top;
  }

  return reverseTransformPoint(adjustedX, adjustedY, transformMatrix);
};

// adjust position to the middle of the node, and with the correct zoom/pan
const adjustPosition = (
  clientX: number,
  clientY: number,
  rect: IContainerRect | undefined,
  transformMatrix: ITransformMatrix,
  node: Partial<ICanvasNode>,
  nodeConfig: INodeConfig | undefined
): IPoint => {
  const rectWidth = getRectWidth(nodeConfig, node);
  const rectHeight = getRectHeight(nodeConfig, node);

  // get transformed width and height
  const realWidth =
    transformMatrix[0] * rectWidth + transformMatrix[2] * rectHeight;
  const realHeight =
    transformMatrix[1] * rectWidth + transformMatrix[3] * rectHeight;

  return adjustedClientPoint(
    clientX - realWidth / 2,
    clientY - realHeight / 2,
    rect,
    transformMatrix
  );
};

/**
 * The Item in the item panel from which we can add node to the canvas.
 *
 * @param props type IItemProps
 * @returns
 */
export const Item: React.FunctionComponent<IItemProps> = (props) => {
  const graphConfig = useGraphConfig();
  const graphController = useGraphController();
  const [workingModel, setWorkingModel] = React.useState<ICanvasNode | null>(
    null
  );
  const nextNodeRef = useRefValue(workingModel);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const { style, children, getNode, dragWillStart = noop } = props;

  const onPointerDown = React.useCallback(
    (evt: React.PointerEvent) => {
      evt.stopPropagation();
      if (
        isMouseButNotLeft(evt) ||
        !graphController.getEnabledFeatures().has(GraphFeatures.AddNewNodes)
      ) {
        return;
      }
      const partial = getNode();
      const nodeConfig =
        graphConfig.getNodeConfig(partial as ICanvasNode) ?? emptyNodeConfig;
      const position = adjustPosition(
        evt.clientX,
        evt.clientY,
        undefined,
        graphController.state.viewport.transformMatrix,
        partial,
        nodeConfig
      );
      const node: ICanvasNode = {
        ...partial,
        ...position,
        id: partial.id || uuid(),
      };

      const drag = new DragController(
        new PointerEventProvider(graphController.getGlobalEventTarget()),
        defaultGetPositionFromEvent
      );

      const eventChannel = graphController.eventChannel;

      eventChannel.trigger({
        type: GraphCanvasEvent.DraggingNodeFromItemPanelStart,
        rawEvent: evt,
      });

      drag.onMove = ({ e }) => {
        setWorkingModel((n) => {
          if (!n) {
            return n;
          }
          return {
            ...n,
            ...adjustPosition(
              e.clientX,
              e.clientY,
              undefined,
              graphController.state.viewport.transformMatrix,
              n,
              nodeConfig
            ),
          };
        });
      };
      drag.onEnd = ({ e }) => {
        const viewport = graphController.state.viewport;
        let nextNode = nextNodeRef.current;
        if (
          !isViewportComplete(viewport) ||
          !nextNode ||
          !isWithInBound(viewport.rect, e.clientX, e.clientY)
        ) {
          setWorkingModel(null);
          eventChannel.trigger({
            type: GraphCanvasEvent.DraggingNodeFromItemPanelEnd,
            node: null,
          });
          return;
        }
        nextNodeRef.current = null;
        nextNode = {
          ...nextNode,
          ...adjustPosition(
            e.clientX,
            e.clientY,
            viewport.rect,
            viewport.transformMatrix,
            nextNode,
            nodeConfig
          ),
        };
        eventChannel.trigger({
          type: GraphCanvasEvent.DraggingNodeFromItemPanelEnd,
          node: nextNode,
        });
        setWorkingModel(null);
      };
      dragWillStart(node);
      setWorkingModel(node);
      drag.start(evt.nativeEvent);
    },
    [graphController, getNode, graphConfig, dragWillStart, nextNodeRef]
  );

  const className = mergeStyles(classes.moduleItem, props.className);

  return (
    <>
      <div
        className={className}
        style={style}
        onPointerDown={onPointerDown}
        role="button"
      >
        {children}
      </div>
      {workingModel &&
        ReactDOM.createPortal(
          <AddingNodeSvg
            svgRef={svgRef}
            model={workingModel}
            nextNodeRef={nextNodeRef}
          />,
          el
        )}
    </>
  );
};
