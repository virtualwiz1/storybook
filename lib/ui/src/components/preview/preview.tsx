import React, { Component, Fragment } from 'react';
import memoize from 'memoizerific';
import { API, Consumer, Combo, State } from '@storybook/api';
import { SET_CURRENT_STORY } from '@storybook/core-events';
import addons, { types, Addon } from '@storybook/addons';
import merge from '@storybook/api/dist/lib/merge';
import { Loader } from '@storybook/components';

import { Helmet } from 'react-helmet-async';

import { Toolbar, defaultTools, defaultToolsExtra, createTabsTool } from './toolbar';

import * as S from './components';

import { ZoomProvider, ZoomConsumer } from './zoom';

import { IFrame } from './iframe';
import { PreviewProps, ApplyWrappersProps, IframeRenderer } from './PreviewProps';

import { defaultWrappers, ApplyWrappers } from './wrappers';
import { stringifyQueryParams } from './stringifyQueryParams';

export const renderIframe: IframeRenderer = (
  storyId,
  viewMode,
  id,
  baseUrl,
  scale,
  queryParams
) => (
  <IFrame
    key="iframe"
    id="storybook-preview-iframe"
    title={id || 'preview'}
    src={`${baseUrl}?id=${storyId}&viewMode=${viewMode}${stringifyQueryParams(queryParams)}`}
    allowFullScreen
    scale={scale}
  />
);

const getWrapper = memoize(1)((getFn: API['getElements']) =>
  Object.values(getFn<Addon>(types.PREVIEW))
);
const getTabs = memoize(1)((getFn: API['getElements']) => Object.values(getFn<Addon>(types.TAB)));
const getTools = memoize(1)((getFn: API['getElements']) => Object.values(getFn<Addon>(types.TOOL)));
const getToolsExtra = memoize(1)((getFn: API['getElements']) =>
  Object.values(getFn<Addon>(types.TOOLEXTRA))
);

const getDocumentTitle = (description: string) => {
  return description ? `${description} ⋅ Storybook` : 'Storybook';
};

const mapper = ({ state, api }: Combo) => ({
  storyId: state.storyId,
  viewMode: state.viewMode,
  customCanvas: api.renderPreview,
  queryParams: state.customQueryParams,
  getElements: api.getElements,
  isLoading: !state.storiesConfigured,
});

const createCanvas = (id: string, baseUrl = 'iframe.html', withLoader = true): Addon => ({
  id: 'canvas',
  title: 'Canvas',
  route: p => `/story/${p.storyId}`,
  match: p => !!(p.viewMode && p.viewMode.match(/^(story|docs)$/)),
  render: p => {
    return (
      <Consumer filter={mapper}>
        {({
          customCanvas,
          storyId,
          viewMode,
          queryParams,
          getElements,
          isLoading,
        }: ReturnType<typeof mapper>) => (
          <ZoomConsumer>
            {({ value: scale }) => {
              const wrappers = [...defaultWrappers, ...getWrapper(getElements)];

              const data = [storyId, viewMode, id, baseUrl, scale, queryParams] as Parameters<
                IframeRenderer
              >;

              const content = customCanvas ? customCanvas(...data) : renderIframe(...data);
              const props = {
                viewMode,
                active: p.active,
                wrappers,
                id,
                storyId,
                baseUrl,
                queryParams,
                scale,
                customCanvas,
              } as ApplyWrappersProps;

              return (
                <>
                  {withLoader && isLoading && <Loader id="preview-loader" role="progressbar" />}
                  <ApplyWrappers {...props}>{content}</ApplyWrappers>
                </>
              );
            }}
          </ZoomConsumer>
        )}
      </Consumer>
    );
  },
});

class Preview extends Component<PreviewProps> {
  shouldComponentUpdate({
    storyId,
    viewMode,
    docsOnly,
    options,
    queryParams,
    parameters,
  }: PreviewProps) {
    const { props } = this;

    return (
      options.isFullscreen !== props.options.isFullscreen ||
      options.isToolshown !== props.options.isToolshown ||
      viewMode !== props.viewMode ||
      docsOnly !== props.docsOnly ||
      storyId !== props.storyId ||
      queryParams !== props.queryParams ||
      parameters !== props.parameters
    );
  }

  componentDidUpdate(prevProps: PreviewProps) {
    const { api, storyId, viewMode } = this.props;
    const { storyId: prevStoryId, viewMode: prevViewMode } = prevProps;
    if ((storyId && storyId !== prevStoryId) || (viewMode && viewMode !== prevViewMode)) {
      api.emit(SET_CURRENT_STORY, { storyId, viewMode });
    }
  }

  render() {
    const { props } = this;
    const {
      id,
      location,
      getElements,
      options,
      docsOnly = false,
      storyId = undefined,
      path = undefined,
      description = undefined,
      baseUrl = 'iframe.html',
      parameters = undefined,
      withLoader = true,
    } = props;
    const viewMode = docsOnly && props.viewMode === 'story' ? 'docs' : props.viewMode;
    const { isToolshown } = options;

    const allTabs = [createCanvas(id, baseUrl, withLoader), ...getTabs(getElements)];
    const tabs = filterTabs(allTabs, parameters);

    const tools = [...defaultTools, ...getTools(getElements)];
    const toolsExtra = [...defaultToolsExtra, ...getToolsExtra(getElements)];

    const { left, right } = filterTools(tools, toolsExtra, tabs, {
      viewMode,
      storyId,
      location,
      path,
    });

    return (
      <ZoomProvider>
        <Fragment>
          {id === 'main' && (
            <Helmet key="description">
              <title>{getDocumentTitle(description)}</title>
            </Helmet>
          )}
          {(left || right) && (
            <Toolbar key="toolbar" shown={isToolshown} border>
              <Fragment key="left">{left}</Fragment>
              <Fragment key="right">{right}</Fragment>
            </Toolbar>
          )}
          <S.FrameWrap key="frame" offset={isToolshown ? 40 : 0}>
            {tabs.map((p, i) => (
              // @ts-ignore
              <Fragment key={p.id || p.key || i}>
                {p.render({ active: p.match({ storyId, viewMode, location, path }) })}
              </Fragment>
            ))}
          </S.FrameWrap>
        </Fragment>
      </ZoomProvider>
    );
  }
}

export { Preview };

function filterTabs(panels: Addon[], parameters: Record<string, any>) {
  const { previewTabs } = addons.getConfig();
  const parametersTabs = parameters ? parameters.previewTabs : undefined;

  if (previewTabs || parametersTabs) {
    // deep merge global and local settings
    const tabs = merge(previewTabs, parametersTabs);
    const arrTabs = Object.keys(tabs).map((key, index) => ({
      index,
      ...(typeof tabs[key] === 'string' ? { title: tabs[key] } : tabs[key]),
      id: key,
    }));
    return panels
      .filter(panel => {
        const t = arrTabs.find(tab => tab.id === panel.id);
        return t === undefined || t.id === 'canvas' || !t.hidden;
      })
      .map((panel, index) => ({ ...panel, index } as Addon))
      .sort((p1, p2) => {
        const tab_1 = arrTabs.find(tab => tab.id === p1.id);
        // @ts-ignore
        const index_1 = tab_1 ? tab_1.index : arrTabs.length + p1.index;
        const tab_2 = arrTabs.find(tab => tab.id === p2.id);
        // @ts-ignore
        const index_2 = tab_2 ? tab_2.index : arrTabs.length + p2.index;
        return index_1 - index_2;
      })
      .map(panel => {
        const t = arrTabs.find(tab => tab.id === panel.id);
        if (t) {
          return {
            ...panel,
            title: t.title || panel.title,
            disabled: t.disabled,
            hidden: t.hidden,
          } as Addon;
        }
        return panel;
      });
  }
  return panels;
}

function filterTools(
  tools: Addon[],
  toolsExtra: Addon[],
  tabs: Addon[],
  {
    viewMode,
    storyId,
    location,
    path,
  }: {
    viewMode: State['viewMode'];
    storyId: State['storyId'];
    location: State['location'];
    path: State['path'];
  }
) {
  const tabsTool = createTabsTool(tabs);
  const toolsLeft = [tabs.filter(p => !p.hidden).length > 1 ? tabsTool : null, ...tools];

  const toolsRight = [...toolsExtra];

  // if its a docsOnly page, even the 'story' view mode is considered 'docs'
  const filter = (item: Partial<Addon>) =>
    item &&
    (!item.match ||
      item.match({
        storyId,
        viewMode,
        location,
        path,
      }));

  const displayItems = (list: Partial<Addon>[]) =>
    list.reduce(
      (acc, item, index) =>
        item ? (
          // @ts-ignore
          <Fragment key={item.id || item.key || `f-${index}`}>
            {acc}
            {item.render({}) || item}
          </Fragment>
        ) : (
          acc
        ),
      null
    );

  const left = displayItems(toolsLeft.filter(filter));
  const right = displayItems(toolsRight.filter(filter));

  return { left, right };
}
