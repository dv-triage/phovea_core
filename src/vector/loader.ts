/* *****************************************************************************
 * Caleydo - Visualization for Molecular Biology - http://caleydo.org
 * Copyright (c) The Caleydo Team. All rights reserved.
 * Licensed under the new BSD license, available at http://caleydo.org/license
 **************************************************************************** */
/**
 * Created by Samuel Gratzl on 04.08.2014.
 */

import {getAPIJSON} from '../ajax';
import {parse} from '../range';
import Range from '../range/Range';
import {IValueType, mask} from '../datatype';
import {IVectorDataDescription} from './IVector';
import {resolve} from '../idtype';

/**
 * @internal
 */
export interface IVectorLoaderResult<T> {
  readonly rowIds: Range;
  readonly rows: string[];
  readonly data: T[];
}

/**
 * @internal
 */
export interface IVectorLoader<T> {
  (desc: IVectorDataDescription<any>): Promise<IVectorLoaderResult<T>>;
}


/**
 * @internal
 */
export function viaAPILoader<T>() {
  let _loader: Promise<IVectorLoaderResult<T>> = undefined;
  return (desc: IVectorDataDescription<any>) => {
    if (_loader) { //in the cache
      return _loader;
    }
    return _loader = getAPIJSON('/dataset/' + desc.id).then((data) => {
      const range = parse(data.rowIds);
      data.rowIds = range;
      data.data = mask(data.data, desc.value);

      const idType = resolve(desc.idtype);
      idType.fillMapCache(range.dim(0).asList(data.rows.length), data.rows);
      return data;
    });
  };
}

/**
 * @internal
 */
export function viaDataLoader<T>(rows: string[], rowIds: number[], data: IValueType[]) {
  let _data: IVectorLoaderResult<T> = undefined;
  return () => {
    if (_data) { //in the cache
      return Promise.resolve(_data);
    }
    _data = {
      rowIds: parse(rowIds),
      rows,
      data
    };
    return Promise.resolve(_data);
  };
}
